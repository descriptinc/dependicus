/**
 * Live test for the Linear `findClosedIssue` query strategy.
 *
 * Validates that the Linear API's StringComparator `contains` filter on
 * issue titles works as expected when combined with label + state filters.
 *
 * Usage: mise run test:find-closed-issue
 * Requires: LINEAR_API_KEY in .env
 */

import { LinearClient } from '@linear/sdk';

const DEPENDICUS_LABEL_NAME = 'Dependicus';

async function main() {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
        console.error('LINEAR_API_KEY not set');
        process.exit(1);
    }

    const client = new LinearClient({ apiKey });

    // Find the Dependicus label
    const labels = await client.issueLabels({
        filter: { name: { eq: DEPENDICUS_LABEL_NAME } },
    });
    const label = labels.nodes[0];
    if (!label) {
        console.error('No Dependicus label found — have you run make-linear-issues before?');
        process.exit(1);
    }
    console.log(`Found label: ${label.name} (${label.id})`);

    // --- Test 1: Query closed issues with a title filter ---
    // First, find ANY closed Dependicus issue to use as a test subject
    console.log('\n--- Finding a closed Dependicus issue to test with ---');
    const anyClosed = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
        },
        first: 1,
    });

    if (anyClosed.nodes.length === 0) {
        console.log('No closed Dependicus issues found. Creating a scenario is out of scope.');
        console.log('Try closing a Dependicus issue manually and re-running.');
        process.exit(0);
    }

    const testIssue = anyClosed.nodes[0]!;
    const testState = await testIssue.state;
    console.log(`Found closed issue: ${testIssue.identifier} "${testIssue.title}"`);
    console.log(`  state: ${testState?.type} / ${testState?.name}`);
    console.log(`  updatedAt: ${testIssue.updatedAt.toISOString()}`);

    // Extract the dependency name from the title
    const titleMatch = testIssue.title.match(/\[Dependicus\]\s+(?:FYI:\s+)?(?:Update\s+)?(\S+)/);
    const depName = titleMatch?.[1];
    if (!depName) {
        console.log(`Could not extract dependency name from title: "${testIssue.title}"`);
        process.exit(1);
    }
    console.log(`  extracted depName: ${depName}`);

    // --- Test 2: Query with title contains filter ---
    console.log(`\n--- Querying with title.contains="${depName}" ---`);
    const filtered = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: depName },
        },
        first: 5,
    });

    console.log(`Results: ${filtered.nodes.length} issues`);
    for (const issue of filtered.nodes) {
        const state = await issue.state;
        console.log(`  ${issue.identifier} "${issue.title}" (${state?.type}/${state?.name})`);
    }

    // --- Test 3: Query with a name that shouldn't match ---
    const bogusName = 'zzz-nonexistent-package-12345';
    console.log(`\n--- Querying with title.contains="${bogusName}" (should be empty) ---`);
    const noResults = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: bogusName },
        },
        first: 1,
    });
    console.log(`Results: ${noResults.nodes.length} issues`);
    if (noResults.nodes.length > 0) {
        console.error('UNEXPECTED: Got results for a bogus name!');
        process.exit(1);
    }

    // --- Test 4: Check first:1 returns only one result ---
    console.log(`\n--- Verifying first:1 limits results ---`);
    const singleResult = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: depName },
        },
        first: 1,
    });
    console.log(`Results with first:1: ${singleResult.nodes.length}`);
    if (singleResult.nodes.length > 1) {
        console.error('UNEXPECTED: first:1 returned more than 1 result');
        process.exit(1);
    }

    // --- Test 5: Check fuzzy match behavior ---
    // If depName is a substring of other package names, do we get false positives?
    console.log(`\n--- Checking if contains filter is fuzzy (substring match) ---`);
    const fuzzyResults = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: depName },
        },
        first: 5,
    });
    const exactMatches = fuzzyResults.nodes.filter((issue) => {
        const match = issue.title.match(/\[Dependicus\]\s+(?:FYI:\s+)?(?:Update\s+)?(\S+)/);
        return match?.[1] === depName;
    });
    console.log(`  Total results for "${depName}": ${fuzzyResults.nodes.length}`);
    console.log(`  Exact dep name matches: ${exactMatches.length}`);
    if (fuzzyResults.nodes.length > exactMatches.length) {
        console.log(
            `  ⚠ Contains filter is fuzzy — need post-filter verification in production code`,
        );
    } else {
        console.log(`  Contains filter was exact for this query`);
    }

    // --- Test 6: Test with a specific known closed issue ---
    console.log(`\n--- Testing with babel-plugin-react-compiler (known closed issue BIX-7982) ---`);
    const babelResults = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: 'babel-plugin-react-compiler' },
        },
        first: 3,
    });
    console.log(`Results: ${babelResults.nodes.length} issues`);
    for (const issue of babelResults.nodes) {
        const state = await issue.state;
        console.log(`  ${issue.identifier} "${issue.title}" (${state?.type}/${state?.name})`);
    }

    // Also test: does searching for just "react" return babel-plugin-react-compiler issues?
    console.log(`\n--- Testing fuzzy: does "react" match "babel-plugin-react-compiler"? ---`);
    const reactResults = await client.issues({
        filter: {
            labels: { id: { eq: label.id } },
            state: { type: { in: ['completed', 'canceled'] } },
            title: { contains: 'react' },
        },
        first: 10,
    });
    console.log(`Results for "react": ${reactResults.nodes.length} issues`);
    for (const issue of reactResults.nodes) {
        console.log(`  ${issue.identifier} "${issue.title}"`);
    }

    console.log('\nAll tests passed.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
