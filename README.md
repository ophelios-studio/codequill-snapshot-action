# Code Quill Snapshot Action

Trigger a Code Quill snapshot for the current repository from GitHub Actions.

A snapshot anchors a cryptographic fingerprint (Merkle root) of your repository state to the blockchain via Code Quill. This action is the easiest way to keep your snapshots up‑to‑date whenever important branches are pushed.

Repository: https://github.com/ophelios-studio/codequill-snapshot-action

---

## Basic usage

Create a workflow, for example `.github/workflows/codequill-snapshot.yml`:
```yaml
name: Code Quill Snapshot

on:
  push:
    branches: [ main ]

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Code Quill snapshot
        uses: ophelios-studio/codequill-snapshot-action@v1
        with:
          api-key: ${{ secrets.CODEQUILL_API_KEY }}
```

## What this action does

When run, the action:

1. Sends a signed POST request to your Code Quill instance at:

   ```text
   https://api.codequill.xyz/v1/app/snapshot
   ```

2. Includes:
   - `github_id`: the numeric GitHub repository id.
   - `branch`: the branch name to snapshot.

3. Code Quill validates:
   - The repository API key.
   - That the action is enabled for this repository.
   - That the snapshot quota is not exceeded.

4. If accepted, Code Quill:
   - Downloads the repo.
   - Hashes files and computes a Merkle root.
   - Anchors it on‑chain.
   - Returns metadata (transaction hash, Merkle root, etc.), which this action exposes as outputs.

---

## Inputs

| Name        | Required | Default                                                           | Description                                                                                         |
|-------------|----------|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `api-key`   | yes      | n/a                                                               | Code Quill repository API key. Store this as a GitHub secret (for example `CODEQUILL_API_KEY`).    |
| `github-id` | no       | `${{ github.repository_id }}`                                     | Numeric GitHub repository id. Auto-resolves to the current repo id if omitted.                     |
| `branch`    | no       | `${{ github.ref_name }}` (the branch that triggered the workflow) | Branch name to snapshot. Override when running from non‑branch refs or custom workflows.           |
| `api-url`   | no       | `https://api.codequill.xyz/v1/app/snapshot`                       | Advanced: override to point at a different Code Quill deployment or environment.                   |

---

## Outputs

These outputs are populated when Code Quill accepts the snapshot request and returns data:

| Name           | Description                                              |
|----------------|----------------------------------------------------------|
| `tx-hash`      | Blockchain transaction hash for the snapshot, if available. |
| `commit-hash`  | Commit hash that was snapshotted.                       |
| `manifest-cid` | Content identifier for the snapshot manifest (if returned). |
| `merkle-root`  | Merkle root of the repository state.                    |

> Note: Output availability depends on the server response. If a field is not present in the response, the corresponding output will be unset.

---


### Steps

1. In Code Quill, generate a repository API key for this repo and enable the GitHub Action integration.
2. In GitHub, create a secret on your repository:
   - Name: `CODEQUILL_API_KEY`
   - Value: the API key from Code Quill.
3. Add the workflow above.
4. Push to `main` (or whatever branch filter you choose).

Each push that matches the trigger will ask Code Quill to create a new snapshot for that branch.

---

## Advanced usage

### Snapshot only specific branches
```yaml
on:
  push:
    branches:
      - main
      - release/*
```

```yaml
jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Snapshot Code Quill
        uses: ophelios-studio/codequill-snapshot-action@v1
        with:
          api-key: ${{ secrets.CODEQUILL_API_KEY }}
          branch: ${{ github.ref_name }}
```
### Trigger snapshots on a schedule

For example, nightly snapshots of `main` even if there are no pushes:
```yaml
on:
  schedule:
    - cron: "0 3 * * *" # 03:00 UTC every day

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Nightly snapshot of main
        uses: ophelios-studio/codequill-snapshot-action@v1
        with:
          api-key: ${{ secrets.CODEQUILL_API_KEY }}
          github-id: ${{ github.repository_id }}
          branch: main
```
### Using outputs

You can surface the transaction hash or Merkle root in later steps:
```yaml
jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger snapshot
        id: cq
        uses: ophelios-studio/codequill-snapshot-action@v1
        with:
          api-key: ${{ secrets.CODEQUILL_API_KEY }}
          github-id: ${{ github.repository_id }}
          branch: ${{ github.ref_name }}

      - name: Log snapshot info
        run: |
          echo "Snapshot tx:      ${{ steps.cq.outputs.tx-hash }}"
          echo "Snapshot commit:  ${{ steps.cq.outputs.commit-hash }}"
          echo "Snapshot merkle:  ${{ steps.cq.outputs.merkle-root }}"
```
You can then surface these values in deployment messages, release notes, or status checks.

---

## Security considerations

- **Never hard‑code your API key**: always use GitHub Secrets (for example `CODEQUILL_API_KEY`).
- Ensure the API key you generate in Code Quill is scoped only to the intended repository.
- Optionally:
  - Use GitHub environment protection rules if you only want snapshots on protected branches.
  - Rotate the API key from Code Quill if it is ever exposed, then update the GitHub secret.

---

## Error handling and troubleshooting

The action attempts to parse the JSON response from Code Quill and will fail the job with a descriptive message when something goes wrong.

Common errors:

- `Missing repository token`  
  The `api-key` provided does not reach the Code Quill server. Check the `CODEQUILL_API_KEY` secret and workflow wiring.

- `Missing github_id` or `Missing branch`  
  Indicates the request payload is missing required fields. Ensure you are passing `github-id` and `branch`, or letting `branch` default to `${{ github.ref_name }}`.

- `Invalid repository token` or `Github id mismatch`  
  Make sure the API key you generated in Code Quill belongs to this repository and that `github-id` uses `${{ github.repository_id }}`.

- `Integration disabled for this repository`  
  Enable the GitHub Action integration for the repository in Code Quill.

- `Monthly snapshot quota exceeded`  
  Your Code Quill subscription has hit its snapshot limit for this month.

When debugging:

- Check the job logs in GitHub Actions; this action prints the HTTP status and any error message returned by the server.

---

## Versioning

Use the major tag for stable integration:
```yaml
uses: ophelios-studio/codequill-snapshot-action@v1
```

---

## Local development and contribution

If you want to modify or contribute to the action:

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build:

   ```bash
   npm run build
   ```

This produces `dist/index.js`, which is what GitHub executes.

4. Commit changes including `dist/` and tag a new version.

---

## License

This project is licensed under the MIT license. See the `LICENSE` file for details.
