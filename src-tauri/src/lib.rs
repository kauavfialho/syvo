// nucleo do syvo em rust (tauri). a tela continua a mesma e fala com isto pela ponte window.syvoNativo.
// protecao do banco: backup do dia antes de abrir, conferencia de integridade e volta pro ultimo backup bom se der pau.
mod banco;

use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

struct Estado { db: Mutex<Connection>, pasta: PathBuf, aviso: Mutex<Option<String>>, idioma: Mutex<String> }

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
fn app_idioma(estado: tauri::State<Estado>, l: String) -> bool { if ["pt", "en", "es"].contains(&l.as_str()) { *estado.idioma.lock().unwrap() = l; } true }

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

// ---- textos das janelas do sistema (o resto da tela ja vem traduzido) ----
fn t(estado: &Estado, pt: &'static str) -> String {
    let l = estado.idioma.lock().unwrap().clone();
    let par: &[(&str, &str, &str)] = &[
        ("Exportar backup do Syvo", "Export Syvo backup", "Exportar copia de Syvo"),
        ("Backup do Syvo", "Syvo backup", "Copia de Syvo"),
        ("Escolha um backup do Syvo", "Choose a Syvo backup", "Elige una copia de Syvo"),
        ("Restaurar este backup?", "Restore this backup?", "¿Restaurar esta copia?"),
        ("Os dados atuais serão substituídos pelos do backup. Antes disso, uma cópia dos dados atuais é guardada na pasta de backups. O app vai reiniciar.", "Your current data will be replaced by the backup. First, a copy of your current data is saved in the backups folder. The app will restart.", "Los datos actuales se reemplazarán por los de la copia. Antes, una copia de los datos actuales se guarda en la carpeta de copias. La app se reiniciará."),
        ("Restaurar", "Restore", "Restaurar"), ("Cancelar", "Cancel", "Cancelar"),
        ("Escolha o comprovante", "Choose the receipt", "Elige el comprobante"), ("PDF ou imagem", "PDF or image", "PDF o imagen"),
    ];
    par.iter().find(|p| p.0 == pt).map(|p| match l.as_str() { "en" => p.1, "es" => p.2, _ => p.0 }).unwrap_or(pt).to_string()
}

const ANEXO_MAX: u64 = 15 * 1024 * 1024;
const ANEXO_EXT: [&str; 4] = ["pdf", "png", "jpg", "jpeg"];

fn banco_valido(c: &Path) -> bool {
    Connection::open_with_flags(c, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map(|db| banco::integridade(&db) == "ok" && db.query_row("select 1 from sqlite_master where type = 'table' and name = 'lancamentos'", [], |_| Ok(())).is_ok()).unwrap_or(false)
}

// fecha o banco de verdade (troca por um em memoria), apaga os arquivos e opcionalmente poe outro no lugar
fn trocar_arquivo(estado: &Estado, novo: Option<&Path>) -> Result<(), String> {
    let arq = estado.pasta.join("syvo.db");
    let destino = estado.pasta.join("backups").join(format!("syvo-backup-{}-{}.db", hoje(), hora()));
    let mut db = estado.db.lock().unwrap();
    copiar_banco(&arq, &destino)?;
    *db = Connection::open_in_memory().map_err(|e| e.to_string())?;
    for ext in ["", "-wal", "-shm"] { let _ = fs::remove_file(estado.pasta.join(format!("syvo.db{ext}"))); }
    if let Some(n) = novo { fs::copy(n, &arq).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn backup_exportar(app: tauri::AppHandle, estado: tauri::State<'_, Estado>) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let escolhido = app.dialog().file().set_title(t(&estado, "Exportar backup do Syvo")).set_file_name(format!("syvo-backup-{}.db", hoje())).add_filter(t(&estado, "Backup do Syvo"), &["db"]).blocking_save_file();
    let Some(p) = escolhido else { return Ok(json!({ "cancelado": true })) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    let temp = std::env::temp_dir().join(format!("syvo-exporta-{}.db", uuid::Uuid::new_v4()));
    { let _g = estado.db.lock().unwrap(); copiar_banco(&estado.pasta.join("syvo.db"), &temp)?; }
    let r = fs::copy(&temp, &p).map_err(|e| e.to_string());
    let _ = fs::remove_file(&temp);
    r?;
    Ok(json!({ "arquivo": p }))
}

#[tauri::command]
async fn backup_restaurar(app: tauri::AppHandle, estado: tauri::State<'_, Estado>) -> Result<Value, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let Some(p) = app.dialog().file().set_title(t(&estado, "Escolha um backup do Syvo")).add_filter(t(&estado, "Backup do Syvo"), &["db"]).blocking_pick_file() else { return Ok(json!({ "cancelado": true })) };
    let origem = p.into_path().map_err(|e| e.to_string())?;
    if !banco_valido(&origem) { return Ok(json!({ "erro": "Esse arquivo não é um backup válido do Syvo." })); }
    let ok = app.dialog().message(t(&estado, "Os dados atuais serão substituídos pelos do backup. Antes disso, uma cópia dos dados atuais é guardada na pasta de backups. O app vai reiniciar."))
        .title(t(&estado, "Restaurar este backup?")).kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(t(&estado, "Restaurar"), t(&estado, "Cancelar"))).blocking_show();
    if !ok { return Ok(json!({ "cancelado": true })); }
    trocar_arquivo(&estado, Some(&origem))?;
    app.restart();
}

#[tauri::command]
fn banco_mostrar(app: tauri::AppHandle, estado: tauri::State<Estado>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(estado.pasta.join("syvo.db")).map_err(|e| e.to_string())
}

#[tauri::command]
fn apagar_tudo(app: tauri::AppHandle, estado: tauri::State<Estado>) -> Result<(), String> {
    // a copia de seguranca fica na pasta de backups, entao da pra voltar atras
    trocar_arquivo(&estado, None)?;
    app.restart();
}

#[tauri::command]
async fn ir_anexar(app: tauri::AppHandle, estado: tauri::State<'_, Estado>, item_id: String) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let existe = { let db = estado.db.lock().unwrap(); db.query_row("select 1 from ir_itens where id = ?1", [&item_id], |_| Ok(())).is_ok() };
    if !existe { return Ok(json!({ "erro": "Item não encontrado." })); }
    let Some(p) = app.dialog().file().set_title(t(&estado, "Escolha o comprovante")).add_filter(t(&estado, "PDF ou imagem"), &ANEXO_EXT).blocking_pick_file() else { return Ok(json!({ "cancelado": true })) };
    let origem = p.into_path().map_err(|e| e.to_string())?;
    let ext = origem.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !ANEXO_EXT.contains(&ext.as_str()) { return Ok(json!({ "erro": "Use um arquivo PDF, PNG ou JPG." })); }
    if fs::metadata(&origem).map(|m| m.len()).unwrap_or(0) > ANEXO_MAX { return Ok(json!({ "erro": "O arquivo passa de 15 MB. Use um arquivo menor." })); }
    let conteudo = fs::read(&origem).map_err(|e| e.to_string())?;
    let nome = origem.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let db = estado.db.lock().unwrap();
    db.execute("insert into ir_anexos (id, criado_em, item_id, nome, conteudo) values (?1, ?2, ?3, ?4, ?5)", rusqlite::params![uuid::Uuid::new_v4().to_string(), banco::agora(), item_id, nome, conteudo]).map_err(|e| e.to_string())?;
    Ok(json!({}))
}

#[tauri::command]
fn ir_anexos(estado: tauri::State<Estado>, ano: i64) -> Result<Value, String> {
    let db = estado.db.lock().unwrap();
    let mut st = db.prepare("select a.id, a.item_id, a.nome from ir_anexos a join ir_itens i on i.id = a.item_id where i.ano = ?1 order by a.criado_em").map_err(|e| e.to_string())?;
    let v: Vec<Value> = st.query_map([ano], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "item_id": r.get::<_, String>(1)?, "nome": r.get::<_, String>(2)? }))).map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    Ok(Value::Array(v))
}

#[tauri::command]
fn ir_abrir_anexo(app: tauri::AppHandle, estado: tauri::State<Estado>, id: String) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    let achado: Option<(String, Vec<u8>)> = { let db = estado.db.lock().unwrap(); db.query_row("select nome, conteudo from ir_anexos where id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?))).ok() };
    let Some((nome, conteudo)) = achado else { return Ok(json!({ "erro": "Comprovante não encontrado." })) };
    let ext = Path::new(&nome).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !ANEXO_EXT.contains(&ext.as_str()) { return Ok(json!({ "erro": "Tipo de arquivo não permitido." })); }
    // copia temporaria com nome nosso, nunca o nome que veio de fora
    let pasta = std::env::temp_dir().join("syvo-anexos");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let destino = pasta.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    fs::write(&destino, conteudo).map_err(|e| e.to_string())?;
    app.opener().open_path(destino.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?;
    Ok(json!({}))
}

#[tauri::command]
fn ir_remover_anexo(estado: tauri::State<Estado>, id: String) -> Result<Value, String> {
    let db = estado.db.lock().unwrap();
    db.execute("delete from ir_anexos where id = ?1", [&id]).map_err(|e| e.to_string())?;
    Ok(json!({}))
}

// erros da tela vao para syvo-erros.log na pasta de dados, pra dar pra investigar
#[tauri::command]
fn log_js(estado: tauri::State<Estado>, msg: String) {
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(estado.pasta.join("syvo-erros.log")) {
        let _ = writeln!(f, "{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg.chars().take(2000).collect::<String>());
    }
}

// so abre a pagina de versoes do proprio syvo, nenhum outro endereco
#[tauri::command]
fn abrir_releases(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url("https://github.com/kauavfialho/syvo/releases/latest", None::<&str>).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let pasta = pasta_dados(app);
            fs::create_dir_all(&pasta)?;
            let aviso = preparar_banco(&pasta);
            let db = banco::abrir(&pasta.join("syvo.db").to_string_lossy()).map_err(|e| e.mensagem)?;
            app.manage(Estado { db: Mutex::new(db), pasta, aviso: Mutex::new(aviso), idioma: Mutex::new("pt".into()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![banco_executar, app_versao, app_aviso, app_idioma, backup_agora, backup_estado, ainda_nao, backup_exportar, backup_restaurar, banco_mostrar, apagar_tudo, ir_anexar, ir_anexos, ir_abrir_anexo, ir_remover_anexo, abrir_releases, log_js])
        .run(tauri::generate_context!())
        .expect("erro ao abrir o syvo");
}
