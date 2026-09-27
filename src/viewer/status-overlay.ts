// Header (tour and scene title), loading indicator, error message and the
// "初期位置" button that returns to where the scene was entered (a way back
// for visitors who wandered off into stray splats).

export interface StatusOverlay {
  setTitles(tourTitle: string, sceneTitle: string): void;
  setLoading(loading: boolean): void;
  showError(message: string): void;
  setResetVisible(visible: boolean): void;
}

export function setupStatusOverlay(onReset: () => void): StatusOverlay {
  const tourTitleEl = document.getElementById("tour-title") as HTMLElement;
  const sceneTitleEl = document.getElementById("scene-title") as HTMLElement;
  const loadingEl = document.getElementById("loading") as HTMLElement;
  const errorEl = document.getElementById("error") as HTMLElement;
  const resetBtn = document.getElementById("reset-view-btn") as HTMLButtonElement;
  resetBtn.addEventListener("click", onReset);

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
    setResetVisible(visible: boolean) {
      resetBtn.hidden = !visible;
    },
  };
}
