use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::process::Command;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProcess {
    pub pid: u32,
    pub name: String,
    pub protocols: String,
    pub ports: Vec<String>,
    pub executable: String,
    pub command_line: String,
    pub started_at: u64,
    pub is_system: bool,
}

#[derive(Default)]
struct PortSet {
    tcp: BTreeSet<u16>,
    udp: BTreeSet<u16>,
}

const CRITICAL_PROCESS_NAMES: &[&str] = &[
    "system",
    "registry",
    "idle",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "winlogon.exe",
    "sihost.exe",
];

fn is_system_process(pid: u32, name: &str, executable: &str) -> bool {
    if pid == 0 || pid == 4 {
        return true;
    }

    if CRITICAL_PROCESS_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
    {
        return true;
    }

    let windows_dir = std::env::var("WINDIR").unwrap_or_else(|_| String::from(r"C:\Windows"));
    !executable.is_empty()
        && executable
            .to_lowercase()
            .starts_with(&windows_dir.to_lowercase())
}

fn process_system() -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(sysinfo::UpdateKind::Always)
            .with_cmd(sysinfo::UpdateKind::Always),
    );
    system
}

#[tauri::command]
pub fn list_port_processes() -> Result<Vec<PortProcess>, String> {
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP | ProtocolFlags::UDP,
    )
    .map_err(|error| format!("无法读取本地端口：{error}"))?;

    let mut grouped: HashMap<u32, PortSet> = HashMap::new();
    for socket in sockets {
        let (protocol, port) = match socket.protocol_socket_info {
            ProtocolSocketInfo::Tcp(info) if info.state == TcpState::Listen => {
                ("TCP", info.local_port)
            }
            ProtocolSocketInfo::Tcp(_) => continue,
            ProtocolSocketInfo::Udp(info) => ("UDP", info.local_port),
        };

        for pid in socket.associated_pids {
            let entry = grouped.entry(pid).or_default();
            match protocol {
                "TCP" => {
                    entry.tcp.insert(port);
                }
                _ => {
                    entry.udp.insert(port);
                }
            }
        }
    }

    let system = process_system();
    let mut rows = grouped
        .into_iter()
        .map(|(pid, ports)| {
            let process = system.process(Pid::from_u32(pid));
            let name = process
                .map(|value| value.name().to_string_lossy().into_owned())
                .unwrap_or_else(|| String::from("[进程已退出]"));
            let executable = process
                .and_then(|value| value.exe())
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            let command_line = process
                .map(|value| {
                    value
                        .cmd()
                        .iter()
                        .map(|part| part.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let started_at = process.map(|value| value.start_time()).unwrap_or_default();

            let mut labels = Vec::with_capacity(ports.tcp.len() + ports.udp.len());
            if ports.udp.is_empty() {
                labels.extend(ports.tcp.iter().map(u16::to_string));
            } else if ports.tcp.is_empty() {
                labels.extend(ports.udp.iter().map(u16::to_string));
            } else {
                labels.extend(ports.tcp.iter().map(|port| format!("TCP:{port}")));
                labels.extend(ports.udp.iter().map(|port| format!("UDP:{port}")));
            }

            let protocols = match (ports.tcp.is_empty(), ports.udp.is_empty()) {
                (false, false) => "TCP / UDP",
                (false, true) => "TCP",
                (true, false) => "UDP",
                (true, true) => "",
            }
            .to_string();

            PortProcess {
                pid,
                name: name.trim_end_matches(".exe").to_string(),
                protocols,
                ports: labels,
                is_system: is_system_process(pid, &name, &executable),
                executable,
                command_line,
                started_at,
            }
        })
        .collect::<Vec<_>>();

    rows.sort_by(|left, right| {
        left.is_system
            .cmp(&right.is_system)
            .then_with(|| right.started_at.cmp(&left.started_at))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    if pid == 0 || pid == 4 || pid == std::process::id() {
        return Err(String::from("已阻止结束受保护进程"));
    }

    let system = process_system();
    let process = system
        .process(Pid::from_u32(pid))
        .ok_or_else(|| format!("PID {pid} 已经退出"))?;
    let name = process.name().to_string_lossy().into_owned();
    let executable = process
        .exe()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    if is_system_process(pid, &name, &executable) {
        return Err(format!("已阻止结束系统进程 {name} (PID {pid})"));
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|error| format!("无法执行 taskkill：{error}"))?;
        if output.status.success() {
            return Ok(());
        }

        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("结束 PID {pid} 失败，可能需要管理员权限")
        } else {
            format!("结束 PID {pid} 失败：{message}")
        });
    }

    #[cfg(not(target_os = "windows"))]
    Err(String::from("当前版本仅实现 Windows 进程结束功能"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_windows_core_processes() {
        assert!(is_system_process(4, "System", ""));
        assert!(is_system_process(
            100,
            "svchost.exe",
            r"C:\Windows\System32\svchost.exe"
        ));
        assert!(is_system_process(
            101,
            "anything.exe",
            r"C:\Windows\System32\anything.exe"
        ));
        assert!(!is_system_process(
            102,
            "node.exe",
            r"C:\Program Files\nodejs\node.exe"
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn kills_a_spawned_listener_process_tree() {
        use std::os::windows::process::CommandExt;
        use std::time::{Duration, Instant};

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut child = Command::new("node.exe")
            .args([
                "-e",
                "require('net').createServer(()=>{}).listen(0,'127.0.0.1')",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("spawn listener process");
        std::thread::sleep(Duration::from_millis(500));

        let rows = list_port_processes().expect("scan");
        assert!(rows.iter().any(|row| row.pid == child.id()));
        kill_process_tree(child.id()).expect("kill process tree");

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if child.try_wait().expect("child state").is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        panic!("listener process did not exit");
    }

    #[test]
    fn port_scan_returns_current_process_when_it_listens() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("address").port().to_string();
        let rows = list_port_processes().expect("scan");
        let row = rows
            .iter()
            .find(|row| row.pid == std::process::id())
            .expect("current process row");
        assert!(row.ports.contains(&port));
    }
}
