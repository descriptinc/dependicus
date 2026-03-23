1. Verify you're on the main branch and it's up to date with origin
2. Parse the current version from `packages/dependicus/package.json`
3. Strip the `-rc.N` suffix to get the stable version (e.g., `0.1.9-rc.5` → `0.1.9`)
    - If the version is already stable (no `-rc.N`), ERROR and tell the user
4. Update the version in `packages/dependicus/package.json`
5. Update CHANGELOG.md: replace "Unreleased" with today's date, remove empty sections
6. Run `mise update-all-lockfiles` to update all lockfiles
7. Commit the version and changelog changes:
    ```bash
    git add packages/dependicus/package.json CHANGELOG.md pnpm-lock.yaml package-lock.json yarn.lock bun.lock
    git commit -m "Release v<version>"
    ```
8. **STOP and ask the user to run `mise release`**. Wait for them to confirm that the publish succeeded before continuing.
9. After the user confirms:
    - Create and push the tag:
        ```bash
        git tag v<version>
        git push origin main
        git push origin v<version>
        ```
    - Create a GitHub release with the changelog notes for this version:
        ```bash
        gh release create v<version> --title "v<version>" --notes-file <(extract release notes from CHANGELOG.md for this version)
        ```
10. Bump to the next patch version with `-rc.0` suffix (e.g., `0.1.9` → `0.1.10-rc.0`), add a new unreleased section to CHANGELOG.md, run `mise update-all-lockfiles`, then commit and push:
    ```bash
    git add packages/dependicus/package.json CHANGELOG.md pnpm-lock.yaml package-lock.json yarn.lock bun.lock
    git commit -m "Begin v<next-version> development"
    git push origin main
    ```
