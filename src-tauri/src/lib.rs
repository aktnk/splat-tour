use tauri_plugin_fs::FsExt;

// Sibling files next to a user-picked splat file (e.g. the annotations sidecar
// JSON) are not covered by the fs scope grant the dialog plugin adds for the
// exact picked path, so we extend the scope to that specific sidecar path here.
#[tauri::command]
fn allow_sidecar_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
  if let Some(scope) = app.try_fs_scope() {
    scope.allow_file(&path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![allow_sidecar_path])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
