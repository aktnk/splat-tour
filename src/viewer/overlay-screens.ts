// DOM parts shared by the mesh and web screens: the bar with "戻る" (and
// "終了" on web pages) and the iframe for web pages. Many sites refuse to be
// framed and there is no reliable way to detect it, so the bar always offers
// to open the page in a new tab as well. The model screen has "戻る" only.

export interface OverlayScreens {
  /** Bar of the model screen: title and "戻る". */
  showMesh(title: string): void;
  showWeb(url: string, title: string): void;
  hide(): void;
}

export function setupOverlayScreens(handlers: { onBack(): void; onExit(): void }): OverlayScreens {
  const bar = document.getElementById("screen-bar") as HTMLElement;
  const titleEl = document.getElementById("screen-title") as HTMLElement;
  const externalLink = document.getElementById("open-external-link") as HTMLAnchorElement;
  const webScreen = document.getElementById("web-screen") as HTMLElement;
  const webFrame = document.getElementById("web-frame") as HTMLIFrameElement;
  const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
  const exitBtn = document.getElementById("exit-btn") as HTMLButtonElement;

  backBtn.addEventListener("click", () => handlers.onBack());
  exitBtn.addEventListener("click", () => handlers.onExit());

  function showBar(title: string, externalUrl: string | undefined, withExit: boolean): void {
    titleEl.textContent = title;
    exitBtn.hidden = !withExit;
    externalLink.hidden = externalUrl === undefined;
    if (externalUrl) {
      externalLink.href = externalUrl;
    }
    bar.hidden = false;
  }

  return {
    showMesh(title: string) {
      showBar(title, undefined, false);
    },
    showWeb(url: string, title: string) {
      webFrame.src = url;
      webScreen.hidden = false;
      showBar(title, url, true);
    },
    hide() {
      bar.hidden = true;
      webScreen.hidden = true;
      // Unload the page so its media and scripts stop.
      webFrame.src = "about:blank";
    },
  };
}
