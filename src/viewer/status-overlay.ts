// Header (tour and scene title), loading indicator and error message.

export interface StatusOverlay {
  setTitles(tourTitle: string, sceneTitle: string): void;
  setLoading(loading: boolean): void;
  showError(message: string): void;
}

export function setupStatusOverlay(): StatusOverlay {
  const tourTitleEl = document.getElementById("tour-title") as HTMLElement;
  const sceneTitleEl = document.getElementById("scene-title") as HTMLElement;
  const loadingEl = document.getElementById("loading") as HTMLElement;
  const errorEl = document.getElementById("error") as HTMLElement;

  return {
    setTitles(tourTitle: string, sceneTitle: string) {
      tourTitleEl.textContent = tourTitle;
      sceneTitleEl.textContent = sceneTitle;
      document.title = `${sceneTitle} - ${tourTitle}`;
    },
    setLoading(loading: boolean) {
      loadingEl.hidden = !loading;
    },
    showError(message: string) {
      loadingEl.hidden = true;
      errorEl.textContent = message;
      errorEl.hidden = false;
    },
  };
}
