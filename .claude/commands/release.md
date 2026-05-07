1. Verify you're on the main branch and it's up to date with origin
2. Parse the current version from `package.json`
3. Strip the `-rc.N` suffix to get the stable version (e.g., `0.1.9-rc.5` → `0.1.9`)
    - If the version is already stable (no `-rc.N`), ERROR and tell the user
4. Update the version in `package.json`
5. Update CHANGELOG.md: replace "Unreleased" with today's date, remove empty sections
6. Run `mise update-all-lockfiles` to update all lockfiles
7. Commit the version and changelog changes:
    ```bash
    git add package.json CHANGELOG.md pnpm-lock.yaml package-lock.json yarn.lock bun.lock aube-lock.yaml
    git commit -m "Release v<version>"
    ```
8. Tag, push, and create a GitHub release with the changelog notes:
    ```bash
    git tag v<version>
    git push origin main
    git push origin v<version>
    gh release create v<version> --title "v<version>" --notes-file <(extract release notes from CHANGELOG.md for this version)
    ```
9. Find the publish workflow run triggered by the release and print its URL for the user:
    ```bash
    gh run list --workflow=publish.yml --limit=1 --json databaseId,url --jq '.[0].url'
    ```
    Tell the user this run requires environment approval before it will publish.
10. Bump to the next patch version with `-rc.0` suffix (e.g., `0.1.9` → `0.1.10-rc.0`), add a new unreleased section to CHANGELOG.md, run `mise update-all-lockfiles`, then commit and push:
    ```bash
    git add package.json CHANGELOG.md pnpm-lock.yaml package-lock.json yarn.lock bun.lock aube-lock.yaml
    git commit -m "Begin v<next-version> development"
    git push origin main
    ```
