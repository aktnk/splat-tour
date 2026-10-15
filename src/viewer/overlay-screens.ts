// DOM parts shared by the mesh and web screens: the bar with "戻る" and the
// iframe for web pages. Many sites refuse to be framed and there is no
// reliable way to detect it, so on web pages the bar also offers to open the
// page in a new tab.

export interface OverlayScreens {
  /** Bar of the model screen: title and "戻る". */
  showMesh(title: string): void;
  showWeb(url: string, title: string): void;
  hide(): void;
}

export function setupOverlayScreens(handlers: { onBack(): void }): OverlayScreens {
  const bar = document.getElementById("screen-bar") as HTMLElement;
  const titleEl = document.getElementById("screen-title") as HTMLElement;
  const externalLink = document.getElementById("open-external-link") as HTMLAnchorElement;
  const webScreen = document.getElementById("web-screen") as HTMLElement;
  const webFrame = document.getElementById("web-frame") as HTMLIFrameElement;
  const backBtn = document.getElementById("back-btn") as HTMLButtonElement;

  backBtn.addEventListener("click", () => handlers.onBack());

  function showBar(title: string, externalUrl: string | undefined): void {
    titleEl.textContent = title;
    externalLink.hidden = externalUrl === undefined;
    if (externalUrl) {
      externalLink.href = externalUrl;
    }
    bar.hidden = false;
  }

  return {
    showMesh(title: string) {
      showBar(title, undefined);
    },
    showWeb(url: string, title: string) {
      webFrame.src = url;
      webScreen.hidden = false;
      showBar(title, url);
    },
    hide() {
      bar.hidden = true;
      webScreen.hidden = true;
      // Unload the page so its media and scripts stop.
      webFrame.src = "about:blank";
    },
  };
}
