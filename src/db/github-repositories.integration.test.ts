import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createDatabase } from "./pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "./runtime/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GitHub repository catalogue", () => {
  it("replaces one connection's repositories and leaves the others alone", async () => {
    const bundle = await embeddedFixture();
    try {
      const database = createDatabase(bundle.runtime, bundle.locks);
      await bundle.runtime.migrate();
      await bundle.runtime.query(
        `insert into organization (id, name, slug) values ('org', 'Org', 'org')`,
      );
      await bundle.runtime.query(
        `insert into github_connections
           (id, organization_id, installation_id, slug, account_id, account_login, account_type, status)
         values
           ('10000000-0000-4000-8000-000000000001', 'org', 42, 'acme', 'account-42', 'acme', 'Organization', 'active'),
           ('10000000-0000-4000-8000-000000000002', 'org', 43, 'orbit', 'account-43', 'orbit', 'Organization', 'active')`,
      );
      const acme = "10000000-0000-4000-8000-000000000001";
      const orbit = "10000000-0000-4000-8000-000000000002";
      await database.replaceGitHubRepositories("org", acme, [
        { repositoryId: 9001, fullName: "acme/app", defaultBranch: "main" },
        { repositoryId: 9002, fullName: "acme/retired", defaultBranch: "main" },
      ]);
      await database.replaceGitHubRepositories("org", orbit, [
        { repositoryId: 9101, fullName: "orbit/app", defaultBranch: "main" },
      ]);

      await database.replaceGitHubRepositories("org", acme, [
        { repositoryId: 9001, fullName: "acme/app", defaultBranch: "develop" },
        { repositoryId: 9003, fullName: "acme/new", defaultBranch: "main" },
      ]);

      assert.deepEqual(await catalogue(database), [
        { connectionId: acme, repositoryId: 9001, fullName: "acme/app", defaultBranch: "develop" },
        { connectionId: acme, repositoryId: 9003, fullName: "acme/new", defaultBranch: "main" },
        { connectionId: orbit, repositoryId: 9101, fullName: "orbit/app", defaultBranch: "main" },
      ]);

      await database.replaceGitHubRepositories("org", acme, []);
      assert.deepEqual(await catalogue(database), [
        { connectionId: orbit, repositoryId: 9101, fullName: "orbit/app", defaultBranch: "main" },
      ]);
    } finally {
      await bundle.runtime.close();
    }
  }, 60_000);
});

async function catalogue(database: ReturnType<typeof createDatabase>) {
  return (await database.listGitHubRepositories("org"))
    .map(({ connectionId, repositoryId, fullName, defaultBranch }) => ({
      connectionId,
      repositoryId,
      fullName,
      defaultBranch,
    }))
    .sort((left, right) => left.repositoryId - right.repositoryId);
}

async function embeddedFixture(): Promise<DatabaseRuntimeBundle> {
  const root = await mkdtemp(join(tmpdir(), "hub-github-repositories-"));
  roots.push(root);
  return embeddedDatabaseRuntime(root);
}
