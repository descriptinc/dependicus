import Handlebars from 'handlebars';

/**
 * Resolve a URL pattern by compiling it as a Handlebars template.
 */
export function resolveUrl(pattern: string, vars: Record<string, string>): string {
    return Handlebars.compile(pattern, { noEscape: true })(vars);
}

/**
 * Resolve all URL patterns from a `Record<label, pattern>` into a sorted
 * array of `{ label, url }`, ready for templates.
 */
export function resolveUrlPatterns(
    patterns: Record<string, string>,
    vars: Record<string, string>,
): Array<{ label: string; url: string }> {
    return Object.entries(patterns)
        .map(([label, pattern]) => ({ label, url: resolveUrl(pattern, vars) }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
