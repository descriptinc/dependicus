#!/usr/bin/env node
import { dependicusCli } from './cli';

void dependicusCli({
    dependicusBaseUrl: '',
    github: {
        getGitHubIssueSpec: () => ({
            owner: 'descriptinc',
            repo: 'dependicus',
            policy: { type: 'fyi' },
        }),
    },
}).run(process.argv);
