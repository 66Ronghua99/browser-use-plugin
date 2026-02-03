
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// Define the global type for AXTree injection
declare global {
    interface Window {
        AXTree: {
            buildAXTreeFlattened: (element: Element) => any;
        }
    }
}

async function capture(url: string, name: string) {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
    });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle0' });

    // Inject the script
    const scriptContent = fs.readFileSync(path.resolve(__dirname, '../dist/content.js'), 'utf8');
    await page.addScriptTag({ content: scriptContent });

    const axTree = await page.evaluate(() => {
        return (window as any).getAXTree();
    });

    const outputDir = path.resolve(__dirname, '../intermediate_results');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(path.join(outputDir, `${name}.json`), JSON.stringify(axTree, null, 2));
    console.log(`Saved AXTree for ${url} to ${name}.json`);

    await browser.close();
}

async function main() {
    await capture('https://www.google.com', 'google');
    await capture('https://github.com', 'github');
    // Add more URLs if needed
}

main().catch(console.error);
