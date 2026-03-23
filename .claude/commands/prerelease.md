1. Verify you're on the main branch and it's up to date with origin
2. Parse the current version from `packages/dependicus/package.json`
3. Validate the version is in format `X.Y.Z-rc.N` (e.g., `0.1.9-rc.5`)
    - If not in this format, ERROR and tell the user to manually fix it first
4. Increment the rc number: `-rc.5` → `-rc.6`
5. Update the version in `packages/dependicus/package.json`
6. Commit the change:
    ```bash
    git add packages/dependicus/package.json
    git commit -m "Prerelease v<new-version>"
    ```
7. **STOP and ask the user to run `mise prerelease`**. Wait for them to confirm that the publish succeeded before continuing.
8. After the user confirms, create and push the tag:
    ```bash
    git tag v<new-version>
    git push origin main
    git push origin v<new-version>
    ```
