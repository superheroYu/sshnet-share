// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::var("SSHNET_ASKPASS").as_deref() == Ok("1") {
        if let Err(error) = print_askpass_password() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    sshnet_share_lib::run()
}

fn print_askpass_password() -> Result<(), String> {
    use std::{
        io::{Read, Write},
        net::{Shutdown, SocketAddr, TcpStream},
        time::Duration,
    };

    let port = std::env::var("SSHNET_ASKPASS_PORT")
        .map_err(|_| "missing SSHNET_ASKPASS_PORT".to_string())?
        .parse::<u16>()
        .map_err(|error| format!("invalid SSHNET_ASKPASS_PORT: {error}"))?;
    let token = std::env::var("SSHNET_ASKPASS_TOKEN")
        .map_err(|_| "missing SSHNET_ASKPASS_TOKEN".to_string())?;

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|error| format!("connect askpass broker failed: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("configure askpass read timeout failed: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("configure askpass write timeout failed: {error}"))?;
    stream
        .write_all(format!("{token}\n").as_bytes())
        .map_err(|error| format!("write askpass token failed: {error}"))?;
    stream
        .shutdown(Shutdown::Write)
        .map_err(|error| format!("finish askpass token failed: {error}"))?;
    let mut password = String::new();
    stream
        .read_to_string(&mut password)
        .map_err(|error| format!("read askpass password failed: {error}"))?;
    print!("{password}");
    Ok(())
}
