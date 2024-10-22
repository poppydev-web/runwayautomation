const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const Bull = require('bull');
const puppeteer = require('puppeteer');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
require('dotenv').config();  // Load environment variables from .env

const app = express();
app.use(bodyParser.json());

// Queue for managing video creation tasks
const videoQueue = new Bull('video-queue');

// Load credentials from .env
const { RUNWAYML_EMAIL, RUNWAYML_PASSWORD, SECRET_KEY } = process.env;

// Middleware for API key authentication
const authenticateAPIKey = (req, res, next) => {
    const token = req.headers['x-api-key'];
    if (!token) {
        return res.status(403).send({ message: 'No API key provided' });
    }

    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) {
            return res.status(403).send({ message: 'Failed to authenticate API key' });
        }
        next();
    });
};

// Endpoint to generate a JWT API key (for testing)
app.post('/generate-key', (req, res) => {
    const token = jwt.sign({}, SECRET_KEY, { expiresIn: '1h' });
    res.json({ apiKey: token });
});

const upload = multer({
    dest: 'uploads/', // You can specify the destination directory
});

// API route to handle video creation request
app.post('/create-video', upload.fields([{ name: 'firstFrame' }, { name: 'lastFrame' }]), async (req, res) => {
    const { engine, prompt } = req.body;
    const firstFrame = req.files.firstFrame[0].path;
    const lastFrame = req.files.lastFrame[0].path;

    console.log('Received first frame:', firstFrame);
    console.log('Received last frame:', lastFrame);
    console.log('Engine:', engine);
    console.log('Prompt:', prompt);

    try {
        // Enqueue the video creation job
        console.log('before create job');
        const job = await videoQueue.add({
            firstFrame,
            lastFrame,
            engine,
            prompt,
        });
        console.log('aftercreaetjob');
        console.log(job);

        return res.status(200).json({
            message: 'Video creation job enqueued successfully',
            jobId: job.id,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to enqueue video creation job', error });
    }
});

// Worker to process the queue and send requests to RunwayML via Puppeteer
videoQueue.process(async (job) => {
    const { firstFrame, lastFrame, engine, prompt } = job.data;
    console.log('Processing video creation for job:', job.id);

    // Login and send video creation request to RunwayML
    const taskId = await createVideoOnRunwayML(firstFrame, lastFrame, engine, prompt);

    if (taskId) {
        console.log(`Task ID for job ${job.id}: ${taskId}`);

        // Poll for video readiness and fetch the final video URL
        const videoUrl = await fetchVideoOnceReady(taskId);
        return { videoUrl };
    } else {
        throw new Error('Failed to create video on RunwayML');
    }
});

videoQueue.on('completed', (job, result) => {
    console.log(`Job completed: ${job.id}, result:`, result);
});

videoQueue.on('failed', (job, err) => {
    console.error(`Job failed: ${job.id}, error:`, err);
});

videoQueue.on('error', (error) => {
    console.error('Queue error:', error);
});

// Function to log in to RunwayML using Puppeteer
async function loginToRunwayML(page) {
    console.log('Logging in to RunwayML...');
    await page.goto('https://app.runwayml.com/login');

    await page.type('input[name="usernameOrEmail"]', RUNWAYML_EMAIL);
    await page.type('input[name="password"]', RUNWAYML_PASSWORD);

    // Click login and wait for navigation
    await page.click('button[type="submit"]');
    await page.waitForNavigation();

    // Save session cookies after login
    const cookies = await page.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies));

    console.log('Logged in and session cookies saved');
}

// Function to load session cookies
async function loadSessionCookies(page) {
    const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
    await page.setCookie(...cookies);
}

// Function to create a video on RunwayML
async function createVideoOnRunwayML(firstFrame, lastFrame, engine, prompt) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Try to load session cookies (reuse existing session)
    if (fs.existsSync('cookies.json')) {
        await loadSessionCookies(page);
        await page.goto('https://runwayml.com/studio');
    } else {
        // Log in if no session exists
        await loginToRunwayML(page);
    }

    // Upload first frame, last frame, and set prompt/engine
    const firstFrameInput = await page.$('input#first-frame');
    await firstFrameInput.uploadFile(firstFrame);

    const lastFrameInput = await page.$('input#last-frame');
    await lastFrameInput.uploadFile(lastFrame);

    await page.select('#engine-selector', engine);
    await page.type('#prompt-input', prompt);

    // Submit and get task ID
    await page.click('#submit-button');
    await page.waitForSelector('#task-id');

    const taskId = await page.evaluate(() => {
        return document.querySelector('#task-id').innerText;
    });

    await browser.close();
    return taskId;
}

// Function to poll RunwayML and fetch video when ready
async function fetchVideoOnceReady(taskId) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Go to the task status page
    await page.goto(`https://runwayml.com/tasks/${taskId}`);

    while (true) {
        const status = await page.evaluate(() => {
            return document.querySelector('#status').innerText;
        });

        if (status === 'completed') {
            const videoUrl = await page.evaluate(() => {
                return document.querySelector('#video-url').getAttribute('href');
            });
            await browser.close();
            return videoUrl;
        }

        // Wait for 5 seconds before polling again
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
