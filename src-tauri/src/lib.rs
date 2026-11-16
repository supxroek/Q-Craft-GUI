use qcraft::config::app_config::AppConfig;
use qcraft::config::dictionary::SchemaDictionary;
use qcraft::core::exporters::{export_query, ExportTarget};
use qcraft::core::previewer::{run_live_preview, PreviewResult};
use qcraft::core::query_ast::QueryAst;
use qcraft::core::schema_graph::{
    connect, fetch_all_databases, fetch_related_foreign_keys, fetch_table_details_with_samples,
    fetch_tables_in_db, ColumnDetail, ForeignKeyRelation, SqlClient, TableInfo,
};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// เก็บ Connection ของ SQL Server ไว้ใน State ของ Tauri (ไม่ต้องต่อใหม่ทุกครั้งที่คลิก)
pub struct DbState {
    pub client: Arc<Mutex<Option<SqlClient>>>,
}

#[tauri::command]
async fn load_saved_config() -> Result<AppConfig, String> {
    AppConfig::load().map_err(|e| e.to_string())
}

#[tauri::command]
async fn connect_database(config: AppConfig, state: State<'_, DbState>) -> Result<Vec<String>, String> {
    // บันทึกค่าลงไฟล์ sqlforge.toml เพื่อใช้ร่วมกับ CLI ได้ด้วย
    config.save().map_err(|e| e.to_string())?;

    let mut client = connect(&config).await.map_err(|e| format!("{:#}", e))?;
    let dbs = fetch_all_databases(&mut client)
        .await
        .map_err(|e| format!("{:#}", e))?;

    let mut guard = state.client.lock().await;
    *guard = Some(client);

    Ok(dbs)
}

#[tauri::command]
async fn get_tables(database: String, state: State<'_, DbState>) -> Result<Vec<TableInfo>, String> {
    let mut guard = state.client.lock().await;
    let client = guard.as_mut().ok_or("ยังไม่ได้เชื่อมต่อฐานข้อมูล")?;

    fetch_tables_in_db(client, &database)
        .await
        .map_err(|e| format!("{:#}", e))
}

#[tauri::command]
async fn get_table_details(
    database: String,
    schema: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<(Vec<ColumnDetail>, Vec<ForeignKeyRelation>), String> {
    let mut guard = state.client.lock().await;
    let client = guard.as_mut().ok_or("ยังไม่ได้เชื่อมต่อฐานข้อมูล")?;

    let cols = fetch_table_details_with_samples(client, &database, &schema, &table)
        .await
        .map_err(|e| format!("{:#}", e))?;

    let fks = fetch_related_foreign_keys(client, &database, &schema, &table)
        .await
        .unwrap_or_default();

    Ok((cols, fks))
}

#[tauri::command]
async fn preview_query_data(
    ast: QueryAst,
    limit: u32,
    state: State<'_, DbState>,
) -> Result<PreviewResult, String> {
    let mut guard = state.client.lock().await;
    let client = guard.as_mut().ok_or("ยังไม่ได้เชื่อมต่อฐานข้อมูล")?;

    run_live_preview(client, &ast, limit)
        .await
        .map_err(|e| format!("{:#}", e))
}

#[tauri::command]
fn compile_and_export(ast: QueryAst, target: String) -> String {
    let export_target = match target.as_str() {
        "csharp" => ExportTarget::CSharp,
        "csharp_bundle" => ExportTarget::CSharpFullBundle,
        "typescript" => ExportTarget::TypeScript,
        _ => ExportTarget::PureSql,
    };
    export_query(&ast, export_target)
}

#[tauri::command]
fn get_dictionary() -> Result<SchemaDictionary, String> {
    SchemaDictionary::load_or_create_template().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    // ดึงค่าจาก Cargo.toml อัตโนมัติด้วย Macro
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState {
            client: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            load_saved_config,
            connect_database,
            get_tables,
            get_table_details,
            preview_query_data,
            compile_and_export,
            get_app_version,
            get_dictionary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
