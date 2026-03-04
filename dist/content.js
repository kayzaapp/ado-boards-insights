(function () {
  // Bundled content script for ADO Boards Insights (dist/content.js)
  // This is a plain-JS bundle of the TypeScript source. It expects the Azure DevOps SDK (azure-devops-extension-sdk)
  // to be loaded by content.html and the host to provide VSS AMD modules.

  // Initialize and guard for SDK
  if (typeof SDK === "undefined" && typeof window !== "undefined") {
    console.error("Azure DevOps SDK is not loaded. Ensure content.html loads azure-devops-extension-sdk.");
  }

  try { SDK.init(); } catch (e) { console.warn("SDK.init() failed", e); }

  SDK.ready().then(function () {
    var webContext = VSS.getWebContext();
    var project = webContext.project;
    var team = webContext.team;

    var statusEl = document.getElementById("status");
    if (statusEl) statusEl.innerText = "Loading story points for project: " + (project ? project.name : "unknown");

    VSS.require(["TFS/Work/RestClient", "TFS/WorkItemTracking/RestClient"], function (WorkRestClient, WitRestClient) {
      try {
        var workClient = WorkRestClient.getClient();
        var witClient = WitRestClient.getClient();

        workClient.getTeamIterations(project.id, team.id, "current")
          .then(function (iterations) {
            if (!iterations || iterations.length === 0) {
              if (statusEl) statusEl.innerText = "No current iteration found for this team.";
              showBadge("No current iteration", 0);
              return;
            }

            var iteration = iterations[0];
            var iterationPath = iteration.path;
            var iterationName = iteration.name || iterationPath;

            if (statusEl) statusEl.innerText = "Found iteration: " + iterationName;

            var wiql = {
              query: "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '" + iterationPath.replace(/'/g, "''") + "' AND [System.WorkItemType] IN ('User Story','Product Backlog Item','Bug')"
            };

            return witClient.queryByWiql(wiql, project.id)
              .then(function (wiqlResult) {
                if (!wiqlResult || !wiqlResult.workItems || wiqlResult.workItems.length === 0) {
                  if (statusEl) statusEl.innerText = iterationName + " — no work items found.";
                  showBadge(iterationName, 0);
                  return Promise.resolve(0);
                }

                var ids = wiqlResult.workItems.map(function (w) { return w.id; });
                return witClient.getWorkItems(ids, ["Microsoft.VSTS.Scheduling.StoryPoints", "System.Title"])
                  .then(function (items) {
                    var total = 0;
                    items.forEach(function (wi) {
                      var sp = wi.fields && wi.fields["Microsoft.VSTS.Scheduling.StoryPoints"];
                      var val = Number(sp);
                      if (!isNaN(val)) total += val;
                    });

                    if (statusEl) statusEl.innerText = iterationName + " — total Story Points: " + total;
                    injectIntoBoardHeaders(iterationName, total);
                    showBadge(iterationName, total);
                    return total;
                  });
              });

          })
          .catch(function (err) {
            if (statusEl) statusEl.innerText = "Error reading iteration or work items: " + (err && err.message ? err.message : err);
            console.error(err);
          });

      } catch (err) {
        if (statusEl) statusEl.innerText = "Client initialization error: " + err;
        console.error(err);
      }
    }, function (err) {
      if (statusEl) statusEl.innerText = "Failed to load REST clients: " + err;
      console.error("VSS.require error", err);
    });

    function injectIntoBoardHeaders(iterationName, totalSP) {
      var appended = false;
      var selectors = [
        ".board-column > .board-column-header",
        ".columns .column .columnHeader",
        ".vss-board-column .vss-board-column-header",
        ".board .columnHeader"
      ];

      var labelHtml = " — " + escapeHtml(iterationName) + ": " + totalSP + " SP";

      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        if (els && els.length > 0) {
          els.forEach(function (el) {
            if (!el.getAttribute("data-sp-injected")) {
              var span = document.createElement("span");
              span.style.marginLeft = "6px";
              span.style.fontSize = "0.9em";
              span.style.color = "#333";
              span.style.fontWeight = "600";
              span.innerText = labelHtml;
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

    function showBadge(iterationName, totalSP) {
      var existing = document.getElementById("sprint-storypoints-badge");
      var content = "<strong>" + escapeHtml(iterationName) + "</strong><small>Total: " + totalSP + " SP</small>";
      if (existing) {
        existing.innerHTML = content;
        return;
      }
      var badge = document.createElement("div");
      badge.id = "sprint-storypoints-badge";
      badge.innerHTML = content;
      document.body.appendChild(badge);
    }

    function escapeHtml(str) {
      if (!str) return "";
      return str.replace(/[&<>\"']/g, function (m) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
      });
    }

  }).catch(function (err) {
    console.error("SDK.ready failed", err);
    var statusEl = document.getElementById("status");
    if (statusEl) statusEl.innerText = "Extension initialization error: " + err;
  });

})();