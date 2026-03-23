1. Verify you're on the main branch and it's up to date with origin
2. Parse the current version from `packages/dependicus/package.json`
3. Validate the version is in format `X.Y.Z-rc.N` (e.g., `0.1.9-rc.5`)
    - If not in this format, ERROR and tell the user to manually fix it first
4. **STOP and ask the user to run `mise prerelease`**. Wait for them to confirm that the publish succeeded before continuing.
5. After the user confirms, tag, push, and create a GitHub prerelease:
    ```bash
    git tag v<current-version>
    git push origin main
    git push origin v<current-version>
    gh release create v<current-version> --prerelease --title "v<current-version>" --notes ""
    ```
6. Increment the rc number: `-rc.5` → `-rc.6`
7. Update the version in `packages/dependicus/package.json`
8. Commit and push:
    ```bash
    git add packages/dependicus/package.json
    git commit -m "Begin v<new-version> development"
    git push origin main
    ```
