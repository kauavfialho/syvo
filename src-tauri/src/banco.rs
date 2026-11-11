// banco do syvo em rust: as mesmas migracoes e o mesmo executor de consultas do electron/banco.js.
// tabela e coluna passam por lista fixa (esquema.json, gerado do banco.js), nunca vira sql direto da tela.
use rusqlite::functions::FunctionFlags;
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(serde::Deserialize)]
struct Esquema {
    migracoes: Vec<String>,
    tabelas: HashMap<String, HashMap<String, String>>,
}

fn esquema() -> &'static Esquema {
    static E: OnceLock<Esquema> = OnceLock::new();
    E.get_or_init(|| serde_json::from_str(include_str!("../esquema.json")).expect("esquema.json invalido"))
}

#[derive(Debug)]
pub struct Erro { pub mensagem: String, pub codigo: &'static str }
fn erro(m: impl Into<String>, c: &'static str) -> Erro { Erro { mensagem: m.into(), codigo: c } }
impl From<rusqlite::Error> for Erro { fn from(e: rusqlite::Error) -> Self { erro(e.to_string(), "ERR_SQLITE_ERROR") } }

pub fn agora() -> String { chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() }

pub fn abrir(caminho: &str) -> Result<Connection, Erro> {
    let db = Connection::open(caminho)?;
    db.execute_batch("pragma foreign_keys = on; pragma journal_mode = wal; pragma synchronous = normal;")?;
    // minuscula que entende acento: o lower do sqlite so sabe a-z
    db.create_scalar_function("minuscula", 1, FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
        Ok(match ctx.get_raw(0) { ValueRef::Null => None, v => Some(match v { ValueRef::Text(t) => String::from_utf8_lossy(t).to_lowercase(), outro => format!("{:?}", outro) }) })
    })?;
    migrar(&db)?;
    Ok(db)
}

pub fn migrar(db: &Connection) -> Result<(), Erro> {
    let versao: usize = db.query_row("pragma user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in esquema().migracoes.iter().enumerate().skip(versao) {
        db.execute_batch("begin")?;
        let r = db.execute_batch(sql).and_then(|_| db.execute_batch(&format!("pragma user_version = {}", i + 1)));
        match r { Ok(_) => db.execute_batch("commit")?, Err(e) => { let _ = db.execute_batch("rollback"); return Err(e.into()); } }
    }
    db.execute("insert or ignore into perfis (id, criado_em) values ('local', ?1)", [agora()])?;
    Ok(())
}

fn colunas_de(tabela: &str) -> Result<&'static HashMap<String, String>, Erro> {
    esquema().tabelas.get(tabela).ok_or_else(|| erro(format!("tabela desconhecida: {tabela}"), "SYVO_TABELA"))
}
fn conferir(tabela: &str, coluna: &str) -> Result<String, Erro> {
    if colunas_de(tabela)?.contains_key(coluna) { Ok(format!("\"{coluna}\"")) } else { Err(erro(format!("coluna desconhecida: {tabela}.{coluna}"), "SYVO_COLUNA")) }
}

fn numero(v: &Value) -> Option<f64> { match v { Value::Number(n) => n.as_f64(), Value::String(s) => s.trim().parse().ok(), Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }), _ => None } }

fn para_banco(tipo: &str, v: &Value) -> Sql {
    if v.is_null() { return Sql::Null; }
    match tipo {
        "bool" => Sql::Integer(match v { Value::Bool(b) => *b as i64, Value::Number(n) => (n.as_f64().unwrap_or(0.0) != 0.0) as i64, Value::String(s) => (!s.is_empty()) as i64, _ => 1 }),
        "json" => Sql::Text(v.to_string()),
        "din" => numero(v).filter(|n| n.is_finite()).map(|n| Sql::Real((n * 100.0).round() / 100.0)).unwrap_or(Sql::Null),
        "int" => numero(v).filter(|n| n.is_finite()).map(|n| Sql::Integer(n.trunc() as i64)).unwrap_or(Sql::Null),
        "real" => numero(v).filter(|n| n.is_finite()).map(Sql::Real).unwrap_or(Sql::Null),
        _ => Sql::Text(match v { Value::String(s) => s.clone(), Value::Bool(b) => b.to_string(), Value::Number(n) => n.to_string(), outro => outro.to_string() }),
    }
}

fn do_banco(tipo: Option<&String>, v: ValueRef) -> Value {
    let base = match v {
        ValueRef::Null => return Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => return Value::Null,
    };
    match tipo.map(|s| s.as_str()) {
        Some("bool") => Value::Bool(match &base { Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0, Value::String(s) => !s.is_empty(), _ => false }),
        Some("json") => match &base { Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null), outro => outro.clone() },
        _ => base,
    }
}

fn linhas(db: &Connection, tabela: &str, sql: &str, valores: &[Sql]) -> Result<Vec<Value>, Erro> {
    let cols = colunas_de(tabela)?;
    let mut st = db.prepare(sql)?;
    let nomes: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = st.query(params_from_iter(valores.iter()))?;
    let mut out = vec![];
    while let Some(r) = rows.next()? {
        let mut m = Map::new();
        for (i, n) in nomes.iter().enumerate() { m.insert(n.clone(), do_banco(cols.get(n), r.get_ref(i)?)); }
        out.push(Value::Object(m));
    }
    Ok(out)
}

fn montar_where(tabela: &str, filtros: &Value) -> Result<(String, Vec<Sql>, usize), Erro> {
    let cols = colunas_de(tabela)?;
    let (mut partes, mut valores) = (vec![], vec![]);
    for f in filtros.as_array().cloned().unwrap_or_default() {
        let c = f["col"].as_str().unwrap_or("");
        if c == "user_id" { continue; }
        let col = conferir(tabela, c)?;
        let tipo = cols.get(c).map(|s| s.as_str()).unwrap_or("txt");
        let val = &f["val"];
        match f["op"].as_str().unwrap_or("") {
            op @ ("eq" | "neq" | "gt" | "gte" | "lt" | "lte") => {
                let s = match op { "eq" => "=", "neq" => "<>", "gt" => ">", "gte" => ">=", "lt" => "<", _ => "<=" };
                partes.push(format!("{col} {s} ?")); valores.push(para_banco(tipo, val));
            }
            "is" => if val.is_null() { partes.push(format!("{col} is null")) } else { partes.push(format!("{col} = ?")); valores.push(Sql::Integer(val.as_bool().unwrap_or(false) as i64)) },
            "not_is" => if val.is_null() { partes.push(format!("{col} is not null")) } else { partes.push(format!("{col} <> ?")); valores.push(Sql::Integer(val.as_bool().unwrap_or(false) as i64)) },
            "in" => {
                let lista = val.as_array().cloned().unwrap_or_default();
                if lista.is_empty() { partes.push("0".into()); continue; }
                partes.push(format!("{col} in ({})", vec!["?"; lista.len()].join(",")));
                lista.iter().for_each(|v| valores.push(para_banco(tipo, v)));
            }
            "ilike" => { partes.push(format!("minuscula({col}) like minuscula(?) escape '\\'")); valores.push(Sql::Text(match val { Value::String(s) => s.clone(), o => o.to_string() })); }
            o => return Err(erro(format!("filtro desconhecido: {o}"), "SYVO_FILTRO")),
        }
    }
    let n = partes.len();
    Ok((if n > 0 { format!(" where {}", partes.join(" and ")) } else { String::new() }, valores, n))
}

fn colunas_select(tabela: &str, texto: &Value) -> Result<String, Erro> {
    let t = texto.as_str().unwrap_or("*").trim();
    if t == "*" || t.is_empty() { return Ok("*".into()); }
    t.split(',').map(|c| conferir(tabela, c.trim())).collect::<Result<Vec<_>, _>>().map(|v| v.join(", "))
}

fn preparar(tabela: &str, linha: &Value) -> Result<Vec<(String, Sql)>, Erro> {
    let cols = colunas_de(tabela)?;
    let mut saida: Vec<(String, Sql)> = vec![];
    for (k, v) in linha.as_object().cloned().unwrap_or_default() {
        if k == "user_id" { continue; }
        conferir(tabela, &k)?;
        saida.push((k.clone(), para_banco(cols.get(&k).map(|s| s.as_str()).unwrap_or("txt"), &v)));
    }
    let tem = |n: &str, s: &Vec<(String, Sql)>| s.iter().any(|(k, v)| k == n && !matches!(v, Sql::Null));
    if !tem("id", &saida) { saida.retain(|(k, _)| k != "id"); saida.push(("id".into(), Sql::Text(uuid::Uuid::new_v4().to_string()))); }
    if !tem("criado_em", &saida) { saida.retain(|(k, _)| k != "criado_em"); saida.push(("criado_em".into(), Sql::Text(agora()))); }
    Ok(saida)
}

fn devolver(db: &Connection, tabela: &str, ids: &[String], retorno: &Value) -> Result<Value, Erro> {
    if retorno.is_null() { return Ok(Value::Null); }
    let cols = colunas_select(tabela, retorno)?;
    let mut out = vec![];
    for id in ids { out.extend(linhas(db, tabela, &format!("select {cols} from \"{tabela}\" where id = ?"), &[Sql::Text(id.clone())])?); }
    Ok(Value::Array(out))
}

fn em_transacao<T>(db: &Connection, f: impl FnOnce() -> Result<T, Erro>) -> Result<T, Erro> {
    db.execute_batch("begin")?;
    match f() { Ok(v) => { db.execute_batch("commit")?; Ok(v) } Err(e) => { let _ = db.execute_batch("rollback"); Err(e) } }
}

fn lista_linhas(d: &Value) -> Vec<Value> { match &d["linhas"] { Value::Array(a) => a.clone(), Value::Null => vec![], o => vec![o.clone()] } }

fn rodar(db: &Connection, d: &Value) -> Result<(Value, Value), Erro> {
    let tabela = d["tabela"].as_str().unwrap_or("");
    colunas_de(tabela)?;
    match d["op"].as_str().unwrap_or("") {
        "select" => {
            let (w, vals, _) = montar_where(tabela, &d["filtros"])?;
            let count = if d["contar"].as_bool().unwrap_or(false) { json!(db.query_row(&format!("select count(*) from \"{tabela}\"{w}"), params_from_iter(vals.iter()), |r| r.get::<_, i64>(0))?) } else { Value::Null };
            if d["semLinhas"].as_bool().unwrap_or(false) { return Ok((Value::Null, count)); }
            let mut ordem = vec![];
            for o in d["ordem"].as_array().cloned().unwrap_or_default() { ordem.push(format!("{} {}", conferir(tabela, o["col"].as_str().unwrap_or(""))?, if o["asc"] == json!(false) { "desc" } else { "asc" })); }
            ordem.push("rowid asc".into());
            let mut sql = format!("select {} from \"{tabela}\"{w} order by {}", colunas_select(tabela, &d["colunas"])?, ordem.join(", "));
            let mut v2 = vals.clone();
            if let Some(l) = d["limite"].as_i64() { sql.push_str(" limit ?"); v2.push(Sql::Integer(l)); }
            Ok((Value::Array(linhas(db, tabela, &sql, &v2)?), count))
        }
        "insert" => {
            let ls = lista_linhas(d).iter().map(|l| preparar(tabela, l)).collect::<Result<Vec<_>, _>>()?;
            if ls.is_empty() { return Ok((json!([]), Value::Null)); }
            let ids = em_transacao(db, || {
                let mut ids = vec![];
                for l in &ls {
                    let cols: Vec<String> = l.iter().map(|(k, _)| format!("\"{k}\"")).collect();
                    db.execute(&format!("insert into \"{tabela}\" ({}) values ({})", cols.join(", "), vec!["?"; cols.len()].join(", ")), params_from_iter(l.iter().map(|(_, v)| v)))?;
                    ids.push(match l.iter().find(|(k, _)| k == "id") { Some((_, Sql::Text(s))) => s.clone(), _ => String::new() });
                }
                Ok(ids)
            })?;
            Ok((devolver(db, tabela, &ids, &d["retorno"])?, Value::Null))
        }
        "update" => {
            let cols = colunas_de(tabela)?;
            let (w, vals, n) = montar_where(tabela, &d["filtros"])?;
            if n == 0 { return Err(erro("update sem filtro nao rola, ia mudar a tabela inteira", "SYVO_SEM_FILTRO")); }
            let ent: Vec<(String, Value)> = d["mudancas"].as_object().cloned().unwrap_or_default().into_iter().filter(|(k, _)| k != "user_id" && k != "id").collect();
            if ent.is_empty() { return Ok((if d["retorno"].is_null() { Value::Null } else { json!([]) }, Value::Null)); }
            let mut sets = vec![]; let mut v2 = vec![];
            for (k, v) in &ent { sets.push(format!("{} = ?", conferir(tabela, k)?)); v2.push(para_banco(cols.get(k).map(|s| s.as_str()).unwrap_or("txt"), v)); }
            let ids: Vec<String> = if d["retorno"].is_null() { vec![] } else { linhas(db, tabela, &format!("select id from \"{tabela}\"{w}"), &vals)?.iter().filter_map(|r| r["id"].as_str().map(String::from)).collect() };
            v2.extend(vals);
            db.execute(&format!("update \"{tabela}\" set {}{w}", sets.join(", ")), params_from_iter(v2.iter()))?;
            Ok((devolver(db, tabela, &ids, &d["retorno"])?, Value::Null))
        }
        "upsert" => {
            let conflito: Vec<String> = d["conflito"].as_str().unwrap_or("id").split(',').map(|c| c.trim().to_string()).filter(|c| !c.is_empty() && c != "user_id").collect();
            for c in &conflito { conferir(tabela, c)?; }
            let ls = lista_linhas(d).iter().map(|l| preparar(tabela, l)).collect::<Result<Vec<_>, _>>()?;
            let ids = em_transacao(db, || {
                let mut ids = vec![];
                for l in &ls {
                    let cols: Vec<&String> = l.iter().map(|(k, _)| k).collect();
                    let atualiza: Vec<String> = cols.iter().filter(|c| c.as_str() != "id" && c.as_str() != "criado_em" && !conflito.contains(c)).map(|c| format!("\"{c}\" = excluded.\"{c}\"")).collect();
                    let acao = if atualiza.is_empty() { "do nothing".to_string() } else { format!("do update set {}", atualiza.join(", ")) };
                    db.execute(&format!("insert into \"{tabela}\" ({}) values ({}) on conflict ({}) {acao}", cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "), vec!["?"; cols.len()].join(", "), conflito.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ")), params_from_iter(l.iter().map(|(_, v)| v)))?;
                    let w = conflito.iter().map(|c| format!("\"{c}\" = ?")).collect::<Vec<_>>().join(" and ");
                    let vals: Vec<Sql> = conflito.iter().map(|c| l.iter().find(|(k, _)| k == c).map(|(_, v)| v.clone()).unwrap_or(Sql::Null)).collect();
                    ids.push(db.query_row(&format!("select id from \"{tabela}\" where {w}"), params_from_iter(vals.iter()), |r| r.get::<_, String>(0))?);
                }
                Ok(ids)
            })?;
            Ok((devolver(db, tabela, &ids, &d["retorno"])?, Value::Null))
        }
        "delete" => {
            let (w, vals, n) = montar_where(tabela, &d["filtros"])?;
            if n == 0 { return Err(erro("delete sem filtro nao rola, ia apagar a tabela inteira", "SYVO_SEM_FILTRO")); }
            db.execute(&format!("delete from \"{tabela}\"{w}"), params_from_iter(vals.iter()))?;
            Ok((Value::Null, Value::Null))
        }
        o => Err(erro(format!("operacao desconhecida: {o}"), "SYVO_OP")),
    }
}

pub fn executar(db: &Connection, d: &Value) -> Value {
    match rodar(db, d) {
        Ok((data, count)) => json!({ "data": data, "count": count, "error": null }),
        Err(e) => json!({ "data": null, "count": null, "error": { "message": e.mensagem, "code": e.codigo } }),
    }
}

// confere se o arquivo esta inteiro. "ok" = tudo certo
pub fn integridade(db: &Connection) -> String {
    db.query_row("pragma integrity_check", [], |r| r.get::<_, String>(0)).unwrap_or_else(|e| e.to_string())
}

#[cfg(test)]
mod testes {
    use super::*;
    fn q(db: &Connection, v: Value) -> Value { executar(db, &v) }
    #[test]
    fn insere_le_atualiza_e_apaga() {
        let db = abrir(":memory:").unwrap();
        let r = q(&db, json!({"tabela":"lancamentos","op":"insert","linhas":[{"tipo":"gastos","mes":"2026-11-01","descricao":"Casa de Pedra","valor":110.004,"pago":false,"user_id":"x"}],"retorno":"id, valor, pago"}));
        assert!(r["error"].is_null(), "{r}");
        assert_eq!(r["data"][0]["valor"], json!(110.0));
        assert_eq!(r["data"][0]["pago"], json!(false));
        let id = r["data"][0]["id"].as_str().unwrap().to_string();
        let s = q(&db, json!({"tabela":"lancamentos","op":"select","colunas":"descricao","filtros":[{"col":"descricao","op":"ilike","val":"%CASA%"}],"ordem":[{"col":"mes","asc":false}],"contar":true}));
        assert_eq!(s["count"], json!(1));
        q(&db, json!({"tabela":"lancamentos","op":"update","mudancas":{"pago":true},"filtros":[{"col":"id","op":"eq","val":id}]}));
        let s = q(&db, json!({"tabela":"lancamentos","op":"select","filtros":[{"col":"pago","op":"is","val":true}]}));
        assert_eq!(s["data"].as_array().unwrap().len(), 1);
        let x = q(&db, json!({"tabela":"lancamentos","op":"delete","filtros":[]}));
        assert_eq!(x["error"]["code"], json!("SYVO_SEM_FILTRO"));
    }
    #[test]
    fn barra_tabela_e_coluna_fora_da_lista() {
        let db = abrir(":memory:").unwrap();
        assert_eq!(q(&db, json!({"tabela":"sqlite_master","op":"select"}))["error"]["code"], json!("SYVO_TABELA"));
        assert_eq!(q(&db, json!({"tabela":"lancamentos","op":"select","colunas":"valor; drop table x"}))["error"]["code"], json!("SYVO_COLUNA"));
    }
    #[test]
    fn upsert_respeita_o_conflito_e_json_volta_objeto() {
        let db = abrir(":memory:").unwrap();
        q(&db, json!({"tabela":"perfis_uso","op":"insert","linhas":{"id":"p1","tipo":"PF","nome":"Pessoal"}}));
        for teto in [1400, 1500] { q(&db, json!({"tabela":"planos_mes","op":"upsert","conflito":"perfil_id,mes","linhas":{"perfil_id":"p1","mes":"2026-12-01","teto":teto,"regras":{"debito":true}}})); }
        let s = q(&db, json!({"tabela":"planos_mes","op":"select"}));
        assert_eq!(s["data"].as_array().unwrap().len(), 1);
        assert_eq!(s["data"][0]["teto"], json!(1500.0));
        assert_eq!(s["data"][0]["regras"]["debito"], json!(true));
    }
}

// equivalencia com o electron: roda uma lista de consultas num banco e grava o resultado.
// uso: SYVO_EQUIV_DB=copia.db SYVO_EQUIV_CONSULTAS=c.json SYVO_EQUIV_SAIDA=r.json cargo test --lib equivalencia -- --ignored
#[cfg(test)]
mod equivalencia {
    #[test]
    #[ignore]
    fn equivalencia() {
        let db = super::abrir(&std::env::var("SYVO_EQUIV_DB").unwrap()).unwrap();
        let cs: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(std::env::var("SYVO_EQUIV_CONSULTAS").unwrap()).unwrap()).unwrap();
        let rs: Vec<serde_json::Value> = cs.iter().map(|c| super::executar(&db, c)).collect();
        std::fs::write(std::env::var("SYVO_EQUIV_SAIDA").unwrap(), serde_json::to_string(&rs).unwrap()).unwrap();
    }
}
