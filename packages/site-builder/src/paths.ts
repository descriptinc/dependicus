import getCssBundle from '@dependicus/site-frontend/css-bundle';

let cachedCss: string | undefined;

/**
 * Bundle the CSS entry point (open-props + styles.css) into a single string.
 * The result is cached so repeated calls don't re-run the bundler.
 */
export async function getCssContent(): Promise<string> {
    if (cachedCss !== undefined) {
        return cachedCss;
    }
    const css = await getCssBundle();
    cachedCss = css;
    return css;
}
