export interface AnnotationMode {
  isEditMode(): boolean;
}

export function setupAnnotationMode(onToggle?: () => void): AnnotationMode {
  const toggleBtn = document.getElementById(
    "edit-mode-toggle-btn",
  ) as HTMLButtonElement;

  let editMode = false;

  function applyState(): void {
    toggleBtn.classList.toggle("active", editMode);
    toggleBtn.textContent = editMode ? "Edit Mode: ON" : "Edit Mode: OFF";
  }

  toggleBtn.addEventListener("click", () => {
    editMode = !editMode;
    applyState();
    onToggle?.();
  });

  applyState();

  return {
    isEditMode() {
      return editMode;
    },
  };
}
