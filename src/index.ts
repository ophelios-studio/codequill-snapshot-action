import * as core from '@actions/core';

type SnapshotResponse = {
    success?: boolean;
    status?: string;
    repository_id?: string | number;
    github_id?: string | number;
    tx_hash?: string;
    manifest_cid?: string;
    commit_hash?: string;
    merkle_root?: string;
    [key: string]: unknown;
};

async function run(): Promise<void> {
    try {
        const apiUrl = core.getInput('api-url', { required: true });
        const apiKey = core.getInput('api-key', { required: true });
        const githubIdInput = core.getInput('github-id', { required: true });
        const branchInput = core.getInput('branch');
        const githubId = Number(githubIdInput);

        if (!Number.isFinite(githubId)) {
            core.setFailed(`Invalid github-id input: "${githubIdInput}" is not a number.`);
            return;
        }

        const branch =
            branchInput && branchInput.trim().length > 0
                ? branchInput.trim()
                : process.env.GITHUB_REF_NAME || '';

        if (!branch) {
            core.setFailed(
                'Branch could not be determined. Pass inputs.branch or ensure GITHUB_REF_NAME is set.'
            );
            return;
        }

        core.info(`Triggering Code Quill snapshot for repo ${githubId} on branch "${branch}"...`);

        const payload = {
            github_id: githubId,
            branch
        };

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CodeQuill-Repo-Key': apiKey
            },
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        let data: SnapshotResponse | undefined;

        try {
            data = text ? (JSON.parse(text) as SnapshotResponse) : undefined;
        } catch {
            // Not JSON – keep raw text for debugging
        }

        if (!res.ok) {
            const detail = data && (data.error as string | undefined);
            const msg =
                `Code Quill snapshot failed: HTTP ${res.status} ${res.statusText}` +
                (detail ? ` - ${detail}` : text ? ` - ${text}` : '');
            core.setFailed(msg);
            return;
        }

        if (data) {
            core.info(`Snapshot accepted by Code Quill: status=${data.status ?? 'n/a'}`);
            if (data.tx_hash) {
                core.info(`Transaction hash: ${data.tx_hash}`);
                core.setOutput('tx-hash', data.tx_hash);
            }
            if (data.commit_hash) {
                core.info(`Commit hash: ${data.commit_hash}`);
                core.setOutput('commit-hash', data.commit_hash);
            }
            if (data.manifest_cid) {
                core.setOutput('manifest-cid', data.manifest_cid);
            }
            if (data.merkle_root) {
                core.setOutput('merkle-root', data.merkle_root);
            }
        } else {
            core.info('Snapshot accepted but response body was empty or not JSON.');
        }
    } catch (err: any) {
        core.setFailed(err?.message ?? String(err));
    }
}

run();