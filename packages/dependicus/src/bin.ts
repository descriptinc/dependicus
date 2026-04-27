#!/usr/bin/env node
import { dependicusCli } from './cli';
import { SecurityPlugin } from '@dependicus/security';
import type { DependicusPlugin } from './plugin';

const githubRoutingPlugin: DependicusPlugin = {
    name: 'github-routing',
    getGitHubIssueSpec: () => ({
        owner: 'descriptinc',
        repo: 'dependicus',
        policy: { type: 'fyi' },
    }),
};

void dependicusCli({
    dependicusBaseUrl: '',
    plugins: [new SecurityPlugin({ osv: true }), githubRoutingPlugin],
}).run(process.argv);
