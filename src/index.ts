import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import { WorkRestClient } from "azure-devops-extension-api/Work";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";

SDK.init();

SDK.ready().then(async () => {
  const statusEl = document.getElementById("status");

  try {
    const projectService = await SDK.getService<any>(
      "ms.vss-tfs-web.tfs-page-data-service"
    );
    const pageData = projectService.getPageData
      ? projectService.getPageData()
      : null;
    const project: string =
      pageData?.project?.name ?? SDK.getHost().name;
    const teamContext = {
      project,
      projectId: pageData?.project?.id,
      team: pageData?.team?.name,
      teamId: pageData?.team?.id,
    };

    if (statusEl) {
      statusEl.innerText = `Loading story points for: ${project}`;
    }

    const workClient = getClient(WorkRestClient);
    const witClient = getClient(WorkItemTrackingRestClient);

    const iterations = await workClient.getTeamIterations(teamContext, "current");

    if (!iterations || iterations.length === 0) {
      if (statusEl) statusEl.innerText = "No current iteration found for this team.";
      showBadge("No current iteration", 0);
      return;
    }

    const iteration = iterations[0];
    const iterationPath = iteration.path ?? "";
    const iterationName = iteration.name ?? iterationPath;

    if (statusEl) statusEl.innerText = `Found iteration: ${iterationName}`;

    const escapedPath = iterationPath.replace(/'/g, "''");
    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '${escapedPath}' AND [System.WorkItemType] IN ('User Story','Product Backlog Item','Bug')`,
    };

    const wiqlResult = await witClient.queryByWiql(wiql, project);

    if (!wiqlResult?.workItems?.length) {
      if (statusEl) statusEl.innerText = `${iterationName} — no work items found.`;
      showBadge(iterationName, 0);
      return;
    }

    const ids = wiqlResult.workItems.map((w) => w.id);
    const items = await witClient.getWorkItems(ids, project, [
      "Microsoft.VSTS.Scheduling.StoryPoints",
      "System.Title",
    ]);

    let total = 0;
    for (const wi of items) {
      const sp = wi.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"];
      const val = Number(sp);
      if (!isNaN(val)) total += val;
    }

    if (statusEl) statusEl.innerText = `${iterationName} — total Story Points: ${total}`;
    injectIntoBoardHeaders(iterationName, total);
    showBadge(iterationName, total);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (statusEl) statusEl.innerText = `Extension error: ${msg}`;
    console.error(err);
  }
}).catch((err) => {
  console.error("SDK.ready failed", err);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.innerText = `Extension initialization error: ${err}`;
});

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[m];
  });
}

function injectIntoBoardHeaders(iterationName: string, totalSP: number): void {
  const selectors = [
    ".board-column > .board-column-header",
    ".columns .column .columnHeader",
    ".vss-board-column .vss-board-column-header",
    ".board .columnHeader",
  ];

  const labelText = ` — ${escapeHtml(iterationName)}: ${totalSP} SP`;
  let appended = false;

  for (const selector of selectors) {
    const els = document.querySelectorAll(selector);
    if (els.length > 0) {
      els.forEach((el) => {
        if (!el.getAttribute("data-sp-injected")) {
          const span = document.createElement("span");
          span.style.marginLeft = "6px";
          span.style.fontSize = "0.9em";
          span.style.color = "#333";
          span.style.fontWeight = "600";
          span.innerText = labelText;
          el.appendChild(span);
          el.setAttribute("data-sp-injected", "true");
        }
      });
      appended = true;
    }
  }

  if (!appended) {
    console.info("Board column header selectors didn't match. Using floating badge fallback.");
  }
}

function showBadge(iterationName: string, totalSP: number): void {
  const content = `<strong>${escapeHtml(iterationName)}</strong><small>Total: ${totalSP} SP</small>`;
  const existing = document.getElementById("sprint-storypoints-badge");
  if (existing) {
    existing.innerHTML = content;
    return;
  }
  const badge = document.createElement("div");
  badge.id = "sprint-storypoints-badge";
  badge.innerHTML = content;
  document.body.appendChild(badge);
}