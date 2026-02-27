import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const root = process.cwd();

const workspaceYaml = yaml.load(
    fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
) as { catalog?: Record<string, string> };

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    catalog?: Record<string, string>;
};

const yamlCatalog = workspaceYaml.catalog ?? {};
const jsonCatalog = packageJson.catalog ?? {};

const allKeys = new Set([...Object.keys(yamlCatalog), ...Object.keys(jsonCatalog)]);

const mismatches: string[] = [];
const onlyInYaml: string[] = [];
const onlyInJson: string[] = [];

for (const key of [...allKeys].sort()) {
    const inYaml = key in yamlCatalog;
    const inJson = key in jsonCatalog;

    if (inYaml && !inJson) {
        onlyInYaml.push(key);
    } else if (!inYaml && inJson) {
        onlyInJson.push(key);
    } else if (yamlCatalog[key] !== jsonCatalog[key]) {
        mismatches.push(
            `  ${key}: workspace="${yamlCatalog[key]}" package.json="${jsonCatalog[key]}"`,
        );
    }
}

let hasError = false;

if (onlyInYaml.length > 0) {
    hasError = true;
    console.error('Only in pnpm-workspace.yaml:');
    for (const key of onlyInYaml) {
        console.error(`  ${key}: ${yamlCatalog[key]}`);
    }
}

if (onlyInJson.length > 0) {
    hasError = true;
    console.error('Only in package.json:');
    for (const key of onlyInJson) {
        console.error(`  ${key}: ${jsonCatalog[key]}`);
    }
}

if (mismatches.length > 0) {
    hasError = true;
    console.error('Version mismatches:');
    for (const line of mismatches) {
        console.error(line);
    }
}

if (hasError) {
    console.error('\nCatalog entries are out of sync.');
    process.exit(1);
} else {
    console.log('Catalogs are in sync.');
}
