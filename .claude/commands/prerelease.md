1. Verify you're on the main branch and it's up to date with origin
2. Parse the current version from `package.json`
3. Validate the version is in format `X.Y.Z-rc.N` (e.g., `0.1.9-rc.5`)
    - If not in this format, ERROR and tell the user to manually fix it first
4. Tag, push, and create a GitHub prerelease:
    ```bash
    git tag v<current-version>
    git push origin main
    git push origin v<current-version>
    gh release create v<current-version> --prerelease --title "v<current-version>" --notes ""
    ```
5. Find the publish workflow run triggered by the release and print its URL for the user:
    ```bash
    gh run list --workflow=publish.yml --limit=1 --json databaseId,url --jq '.[0].url'
    ```
    Tell the user this run requires environment approval before it will publish.
6. Increment the rc number: `-rc.5` → `-rc.6`
7. Update the version in `package.json`
8. Run `mise update-all-lockfiles` to update all lockfiles
9. Commit and push:
    ```bash
    git add package.json pnpm-lock.yaml package-lock.json yarn.lock bun.lock aube-lock.yaml
    git commit -m "Begin v<new-version> development"
    git push origin main
    ```
