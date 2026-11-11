// nucleo do syvo em rust (tauri). a tela continua a mesma e fala com isto pela ponte window.syvoNativo.
// protecao do banco: backup do dia antes de abrir, conferencia de integridade e volta pro ultimo backup bom se der pau.
mod banco;

use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

struct Estado { db: Mutex<Connection>, pasta: PathBuf, aviso: Mutex<Option<String>> }

const BACKUPS_GUARDADOS: usize = 30;

fn pasta_dados(app: &tauri::App) -> PathBuf {
    if let Ok(p) = std::env::var("SYVO_PASTA_DADOS") { return PathBuf::from(p); }
    let base = app.path().data_dir().expect("sem pasta de dados");
    // em desenvolvimento nunca encosta nos dados reais
    if cfg!(debug_assertions) { base.join("Syvo-tauri-teste") } else { base.join("Syvo") }
}

fn hoje() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }
fn hora() -> String { chrono::Local::now().format("%H%M%S").to_string() }

// copia segura de um banco sqlite (pega o que estiver no wal tambem)
fn copiar_banco(origem: &Path, destino: &Path) -> Result<(), String> {
    let c = Connection::open_with_flags(origem, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(destino);
    c.execute("vacuum into ?1", [destino.to_string_lossy()]).map_err(|e| e.to_string())?;
    Ok(())
}

fn backups(pasta: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(pasta.join("backups")).map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.file_name().map(|n| { let n = n.to_string_lossy(); n.starts_with("syvo-backup-") && n.ends_with(".db") }).unwrap_or(false)).collect()).unwrap_or_default();
    v.sort(); v.reverse(); v
}

fn podar(pasta: &Path) { for p in backups(pasta).into_iter().skip(BACKUPS_GUARDADOS) { let _ = fs::remove_file(p); } }

fn integro(caminho: &Path) -> bool {
    Connection::open_with_flags(caminho, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map(|c| banco::integridade(&c) == "ok").unwrap_or(false)
}

// prepara o arquivo antes de abrir: confere, recupera se precisar e faz o backup do dia
fn preparar_banco(pasta: &Path) -> Option<String> {
    let _ = fs::create_dir_all(pasta.join("backups"));
    let arq = pasta.join("syvo.db");
    if !arq.exists() { return None; }
    let mut aviso = None;
    if !integro(&arq) {
        let guardado = pasta.join("backups").join(format!("danificado-{}-{}.db", hoje(), hora()));
        let _ = fs::rename(&arq, &guardado);
        for ext in ["-wal", "-shm"] { let _ = fs::remove_file(pasta.join(format!("syvo.db{ext}"))); }
        match backups(pasta).into_iter().find(|b| integro(b)) {
            Some(bom) => { let _ = fs::copy(&bom, &arq); aviso = Some(format!("O arquivo do Syvo estava danificado. Voltei para o backup {}. O arquivo com problema ficou guardado em {}.", bom.file_name().unwrap().to_string_lossy(), guardado.display())); }
            None => { aviso = Some(format!("O arquivo do Syvo estava danificado e não achei backup bom. Ele ficou guardado em {}. O Syvo começou vazio.", guardado.display())); }
        }
    }
    let do_dia = pasta.join("backups").join(format!("syvo-backup-{}.db", hoje()));
    if !do_dia.exists() { let _ = copiar_banco(&arq, &do_dia); podar(pasta); }
    aviso
}

#[tauri::command]
fn banco_executar(estado: tauri::State<Estado>, d: Value) -> Value {
    let db = estado.db.lock().unwrap();
    banco::executar(&db, &d)
}

#[tauri::command]
fn app_versao(app: tauri::AppHandle) -> String { app.package_info().version.to_string() }

#[tauri::command]
fn app_aviso(estado: tauri::State<Estado>) -> Option<String> { estado.aviso.lock().unwrap().take() }

#[tauri::command]
fn app_idioma(_l: String) -> bool { true }

#[tauri::command]
fn backup_agora(estado: tauri::State<Estado>) -> Value {
    let destino = estado.pasta.join("backups").join(format!("syvo-backup-{}-{}.db", hoje(), hora()));
    let _guard = estado.db.lock().unwrap();
    match copiar_banco(&estado.pasta.join("syvo.db"), &destino) { Ok(_) => { podar(&estado.pasta); json!({ "ok": true, "arquivo": destino }) } Err(e) => json!({ "ok": false, "erro": e }) }
}

#[tauri::command]
fn backup_estado(estado: tauri::State<Estado>) -> Value {
    let lista = backups(&estado.pasta);
    json!({ "pasta": estado.pasta.join("backups"), "quantos": lista.len(), "ultimo": lista.first().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()) })
}

#[tauri::command]
fn ainda_nao() -> Value { json!({ "ok": false, "erro": "Ainda não disponível na versão nova do Syvo." }) }

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let pasta = pasta_dados(app);
            fs::create_dir_all(&pasta)?;
            let aviso = preparar_banco(&pasta);
            let db = banco::abrir(&pasta.join("syvo.db").to_string_lossy()).map_err(|e| e.mensagem)?;
            app.manage(Estado { db: Mutex::new(db), pasta, aviso: Mutex::new(aviso) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![banco_executar, app_versao, app_aviso, app_idioma, backup_agora, backup_estado, ainda_nao])
        .run(tauri::generate_context!())
        .expect("erro ao abrir o syvo");
}
