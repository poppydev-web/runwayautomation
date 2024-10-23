const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

let browser = null;
let page = null;
let isLoggedIn = false;
let requestQueue = [];

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const originalName = file.originalname;
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${baseName}-${uniqueSuffix}${extension}`);
    }
});
const upload = multer({ storage });

async function launchBrowser() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for restricted environments
    });
    page = await browser.newPage();
    page.setDefaultTimeout(600000);
}
async function login(page) {
    console.log('Navigating to login page...');
    await page.goto('https://app.runwayml.com/login');
    console.log('Typing username and password...');
    await page.type('input[name="usernameOrEmail"]', process.env.RUNWAYML_EMAIL); // Replace with your email
    await page.type('input[name="password"]', process.env.RUNWAYML_PASSWORD); // Replace with your password
    await page.click('button[type="submit"]');
    console.log('Logging in...');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Login successful!');
    isLoggedIn = true; // Mark as logged in after first login
}

async function uploadFrame(page, inputSelector, filePath) {
    console.log(`Uploading frame from ${filePath}...`);
    const inputFrame = await page.waitForSelector(inputSelector, { visible: false, timeout: 600000 });
    await page.evaluate((input) => {
        input.style.display = 'block';
    }, inputFrame);
    await inputFrame.uploadFile(filePath);
    console.log('Frame uploaded successfully!');
}

async function clickCropButton(page) {
    console.log('Waiting for image to appear...');
    await page.waitForSelector('div.advanced-cropper-draggable-element.advanced-cropper-rectangle-stencil__draggable-area', { visible: true });
    console.log('Image appeared, clicking Crop button...');
    await page.evaluate(() => {
        const cropButton = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Crop');
        if (cropButton) {
            cropButton.click();
            console.log('Crop button clicked');
        } else {
            console.log('Crop button not found');
        }
    });
}

async function clickLastButton(page) {
    console.log('Waiting for "+ Last" button...');
    await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('button')).some(el => el.textContent.includes('Last'));
    }, { timeout: 600000 });

    console.log('Clicking "+ Last" button...');
    await page.evaluate(() => {
        const lastButton = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Last'));
        if (lastButton) {
            lastButton.click();
            console.log('+ Last button clicked');
        } else {
            console.log('+ Last button not found');
        }
    });
}

async function enterTextPrompt(page, promptText) {
    console.log('Waiting for text prompt input...');
    await page.waitForSelector('div[contenteditable="true"][aria-label="Text Prompt Input"]', { visible: true });
    console.log('Clicking text prompt input...');
    await page.click('div[contenteditable="true"][aria-label="Text Prompt Input"]');
    console.log(`Typing text prompt: ${promptText}...`);
    await page.keyboard.type(promptText);
    console.log('Text prompt entered!');
}

async function clickGenerateButton(page) {
    console.log('Clicking Generate button...');
    await page.evaluate(() => {
        const generateButton = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Generate');
        if (generateButton) {
            generateButton.click();
            console.log('Generate button clicked');
        } else {
            console.log('Generate button not found');
        }
    });
}

async function waitForVideoAndLogSrc(page) {
    console.log('Waiting for video to appear...');

    let videoAppeared = false;
    let queueMessageAppeared = false;
    let readyToGenerateAppeared = false;
    const maxWaitTime = 1200000; // 20 minutes
    const checkInterval = 5000; // Check every 5 seconds
    let elapsedTime = 0;
    let queueMessageStartTime = null;
    const queueMessageTimeout = 300000; // 5 minutes

    while (!videoAppeared && elapsedTime < maxWaitTime) {
        // Check if the video element is present
        videoAppeared = await page.evaluate(() => {
            const videoElement = document.querySelector('video');
            return !!videoElement; // Check if the video element exists
        });

        // Check if the queue message is present
        queueMessageAppeared = await page.evaluate(() => {
            const queueMessageElement = Array.from(document.querySelectorAll('span')).find(
                el => el.textContent.trim() === "Your video is in queue and will start in a few minutes."
            );
            return !!queueMessageElement;
        });

        // Check if the "You're ready to generate." message is present
        if (!readyToGenerateAppeared) {
            readyToGenerateAppeared = await page.evaluate(() => {
                const readyMessageElement = Array.from(document.querySelectorAll('span')).find(
                    el => el.textContent.trim() === "You're ready to generate."
                );
                return !!readyMessageElement;
            });

            if (readyToGenerateAppeared) {
                console.log('"You\'re ready to generate." message appeared. Clicking Generate button once...');
                await clickGenerateButton(page); // Click the Generate button only once
            }
        }

        if (queueMessageAppeared) {
            if (!queueMessageStartTime) {
                // Record the time when the queue message first appears
                queueMessageStartTime = elapsedTime;
                console.log('Queue message appeared. Tracking time...');
            } else if (elapsedTime - queueMessageStartTime > queueMessageTimeout) {
                // If the queue message has been visible for more than 5 minutes
                console.log('Queue message has been visible for more than 5 minutes. Clicking Generate again...');
                await clickGenerateButton(page);
                queueMessageStartTime = elapsedTime; // Reset the timer
            }
        } else {
            // Reset queue message tracking if it's not visible anymore
            queueMessageStartTime = null;
        }

        if (!videoAppeared) {
            console.log('Video not appeared yet. Waiting...');
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            elapsedTime += checkInterval;
        }
    }

    if (!videoAppeared) {
        throw new Error('Video element did not appear within the expected time');
    }

    console.log('Video appeared! Fetching video src...');
    const videoSourceSrc = await page.evaluate(() => {
        const videoElement = document.querySelector('video');
        const sourceElement = videoElement ? videoElement.querySelector('source') : null;
        return sourceElement ? sourceElement.src : 'Source element not found';
    });

    return videoSourceSrc;
}



async function changeModel(page, type) {
    console.log('Changing model...');

    // Navigate to the model selection page
    await page.goto('https://app.runwayml.com/video-tools/teams/rafael788/ai-tools/generative-video', { waitUntil: 'networkidle2' });
    await page.waitForSelector('button[data-testid="select-base-model"]', { visible: true });

    console.log('Clicking model selector button...');
    await page.click('button[data-testid="select-base-model"]');

    // Wait for the menu items to appear
    await page.waitForSelector('div[role="menuitem"]', { visible: true });

    let modelName;
    if (type === 'gen3_turbo') {
        modelName = 'Gen-3 Alpha Turbo';
    } else if (type === 'gen3') {
        modelName = 'Gen-3 Alpha';
    } else {
        throw new Error(`Unknown model type: ${type}`);
    }

    console.log(`Selecting model: ${modelName}...`);
    await page.evaluate((modelName) => {
        const menuItem = Array.from(document.querySelectorAll('div[role="menuitem"]')).find(
            el => el.textContent.includes(modelName)
        );
        if (menuItem) {
            menuItem.click();
            console.log(`${modelName} model selected!`);
        } else {
            console.log(`Model ${modelName} not found.`);
        }
    }, modelName);

    console.log('Model changed!');
}

// Puppeteer logic in a function
async function generateVideo(firstFramePath, lastFramePath, engine, prompt) {

    // Navigate to the Generative Video tool (skipping login)
    // await navigateToGenerativeVideo(page);

    await changeModel(page, engine);

    // Continue with video generation steps...
    console.log(firstFramePath, lastFramePath);
    await uploadFrame(page, 'input[type="file"]', firstFramePath);
    await clickCropButton(page);
    await clickLastButton(page);
    await uploadFrame(page, 'input[type="file"]', lastFramePath);
    await clickCropButton(page);
    await enterTextPrompt(page, prompt);
    await clickGenerateButton(page);
    const videoSrc = await waitForVideoAndLogSrc(page);
    console.log('All steps completed successfully!');

    return videoSrc;
}

// Queue processing
function processQueue() {
    if (requestQueue.length > 0) {
        const { firstFramePath, lastFramePath,engine, prompt, res } = requestQueue[0]; // Get the first job without removing it
        generateVideo(firstFramePath, lastFramePath, engine, prompt)
            .then(videoSrc => {
                res.json({ videoSrc });
                requestQueue.shift(); // Remove the job after completion
                processQueue(); // Move to next request after completion
            })
            .catch(error => {
                console.error('Error creating video:', error);
                res.status(500).json({ error: 'Failed to generate video' });
                requestQueue.shift(); // Remove the job even if it failed
                processQueue(); // Move to next request even on error
            });
    }
}


// API to handle video creation
app.post('/create-video', upload.fields([{ name: 'firstFrame' }, { name: 'lastFrame' }]), (req, res) => {
    const { engine, prompt } = req.body;
    const firstFramePath = req.files['firstFrame'][0].path;
    const lastFramePath = req.files['lastFrame'][0].path;

    requestQueue.push({ firstFramePath, lastFramePath, engine, prompt, res });
    console.log('requestlength', requestQueue.length);
    if (requestQueue.length === 1) {
        processQueue(); // Start processing immediately if it's the only request
    }
});

// New endpoint to reset the project
app.post('/reset-project', async (req, res) => {
    try {
        // Close browser if open
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
            browser = null;
            page = null;
            isLoggedIn = false;
        }

        // Clear the request queue
        requestQueue = [];
        console.log('Request queue cleared.');
        res.json({ message: 'Project reset successfully' });
    } catch (error) {
        console.error('Error resetting project:', error);
        res.status(500).json({ error: 'Failed to reset project' });
    }
});

// Start the server
app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);
    if (!browser || !page) {
        await launchBrowser();
    }

    // Perform login if not already logged in
    if (!isLoggedIn) {
        await login(page);
    }
});
