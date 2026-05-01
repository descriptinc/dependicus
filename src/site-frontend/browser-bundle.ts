import content from './browser-bundle.asset.js';

export default async function getBrowserBundle(): Promise<string> {
    return content;
}
