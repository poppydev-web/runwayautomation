const puppeteer = require('puppeteer');

async function launchBrowser() {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(600000);
}

async function login(page) {
    console.log('Navigating to login page...');
    await page.goto('https://app.runwayml.com/login');
    console.log('Typing username and password...');
    await page.type('input[name="usernameOrEmail"]', 'rafael@epicmegacorp.com'); // Replace with your email
    await page.type('input[name="password"]', 'KEW.qrv_aku6wxp!qaw'); // Replace with your password
    await page.click('button[type="submit"]');
    console.log('Logging in...');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Login successful!');
}

async function navigateToGenerativeVideo(page) {
    console.log('Navigating to dashboard...');
    await page.goto('https://app.runwayml.com/video-tools/teams/rafael788/dashboard', { waitUntil: 'networkidle2' });
    console.log('Waiting for Generative Video link...');
    await page.waitForSelector('a[href="/ai-tools/generative-video"]', { visible: true });
    console.log('Clicking Generative Video link...');
    await page.click('a[href="/ai-tools/generative-video"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Navigated to Generative Video tool!');
}

async function changeModel(page) {
    console.log('Changing model...');
    await page.goto('https://app.runwayml.com/video-tools/teams/rafael788/ai-tools/generative-video', { waitUntil: 'networkidle2' });
    await page.waitForSelector('button[data-testid="select-base-model"]', { visible: true });
    console.log('Clicking model selector button...');
    await page.click('button[data-testid="select-base-model"]');
    await page.waitForSelector('div[role="menuitem"]', { visible: true });
    console.log('Selecting model...');
    await page.click('div[role="menuitem"]');
    console.log('Model changed!');
}

async function uploadFrame(page, inputSelector, filePath) {
    console.log(`Uploading frame from ${filePath}...`);
    const inputFrame = await page.$(inputSelector);
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
        return Array.from(document.querySelectorAll('button')).some(el => el.textContent.trim() === '+ Last');
    }, { timeout: 60000 });

    console.log('Clicking "+ Last" button...');
    await page.evaluate(() => {
        const lastButton = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '+ Last');
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
    await page.waitForSelector('video', { visible: true });
    console.log('Video appeared! Fetching video src...');

    const videoSourceSrc = await page.evaluate(() => {
        const videoElement = document.querySelector('video');
        const sourceElement = videoElement ? videoElement.querySelector('source') : null;
        return sourceElement ? sourceElement.src : 'Source element not found';
    });

    console.log('Video src:', videoSourceSrc);
}

(async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);

    // Login
    await login(page);

    // Navigate to the Generative Video tool
    await navigateToGenerativeVideo(page);

    // Change model
    await changeModel(page);

    // Upload first frame
    await uploadFrame(page, 'input[type="file"]', './uploads/1.jpg');

    // Crop first frame
    await clickCropButton(page);

    // Click "+ Last" and upload second frame
    await clickLastButton(page);
    await uploadFrame(page, 'input[type="file"]', './uploads/4.webp');

    // Crop second frame
    await clickCropButton(page);

    // Enter text prompt
    await enterTextPrompt(page, 'Tiger becomes dog.');

    // Click generate button
    await clickGenerateButton(page);

    // Wait for the video and log the video source URL
    await waitForVideoAndLogSrc(page);

    console.log('All steps completed successfully!');
    await browser.close();
})();
