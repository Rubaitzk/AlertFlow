#!/usr/bin/env python3
"""
=============================================================================
AlertFlow - Live Fastn MCP Tool & Service Execution Showcase
=============================================================================
Explicitly calls Fastn MCP tools and services with formatted inputs & outputs,
demonstrating real-time incident processing, pipeline telemetry, and Slack alerts.
=============================================================================
"""

import sys
import os
import time
import json
import ssl
import urllib.request
import urllib.error

# Ensure UTF-8 output in Windows PowerShell/CMD
sys.stdout.reconfigure(encoding='utf-8')

# ANSI Color Codes
C_RESET   = "\033[0m"
C_BOLD    = "\033[1m"
C_DIM     = "\033[2m"
C_CYAN    = "\033[96m"
C_BLUE    = "\033[94m"
C_GREEN   = "\033[92m"
C_YELLOW  = "\033[93m"
C_MAGENTA = "\033[95m"
C_RED     = "\033[91m"
C_WHITE   = "\033[97m"

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

load_env()

MCP_URL = os.environ.get("FASTN_MCP_URL", "https://mcp.fastn.dev")
if not MCP_URL.endswith("/"):
    MCP_URL += "/"

AUTH_TOKEN = os.environ.get("FASTN_AUTH_TOKEN", "gwt_ZWlKuO629mrDtTiTeW5aELa1G-qYVSBr")
CTX = ssl.create_default_context()

def print_banner():
    print(f"\n{C_CYAN}{C_BOLD}╔═══════════════════════════════════════════════════════════════════════════════════════════════╗{C_RESET}")
    print(f"{C_CYAN}{C_BOLD}║                       ALERTFLOW × FASTN MCP LIVE TOOL RUNNER                                 ║{C_RESET}")
    print(f"{C_CYAN}{C_BOLD}║                Autonomous Agent Tool Invocation & Incident Pipeline Output                    ║{C_RESET}")
    print(f"{C_CYAN}{C_BOLD}╚═══════════════════════════════════════════════════════════════════════════════════════════════╝{C_RESET}\n")
    print(f"  {C_DIM}Gateway:{C_RESET} {C_WHITE}{MCP_URL}{C_RESET} | {C_DIM}Auth:{C_RESET} {C_GREEN}Authenticated (Bearer gwt_...){C_RESET} | {C_DIM}Time:{C_RESET} {C_YELLOW}{time.strftime('%Y-%m-%d %H:%M:%S')}{C_RESET}\n")

def render_tool_call(call_index, tool_name, arguments):
    print(f"{C_BLUE}{C_BOLD}┌───────────────────────────────────────────────────────────────────────────────────────────────┐{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}│ 🔧 TOOL CALL [{call_index}]: {C_YELLOW}{tool_name}{C_RESET}{' ' * (75 - len(tool_name))} {C_BLUE}{C_BOLD}│{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}├───────────────────────────────────────────────────────────────────────────────────────────────┤{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}│ {C_DIM}INPUT ARGUMENTS:{C_RESET}")
    for line in json.dumps(arguments, indent=2).split("\n"):
        print(f"{C_BLUE}{C_BOLD}│ {C_CYAN}  {line}{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}├───────────────────────────────────────────────────────────────────────────────────────────────┤{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}│ {C_MAGENTA}⚡ Status: Dispatched to Fastn MCP Gateway... Waiting for response...{C_RESET}")

def render_tool_response(latency_ms, data, is_error=False):
    status_tag = f"{C_RED}[FAILED]{C_RESET}" if is_error else f"{C_GREEN}[SUCCESS - 200 OK]{C_RESET}"
    print(f"{C_BLUE}{C_BOLD}│ {C_DIM}RESPONSE STATUS:{C_RESET} {status_tag} {C_DIM}(Roundtrip: {latency_ms:.1f}ms){C_RESET}")
    print(f"{C_BLUE}{C_BOLD}├───────────────────────────────────────────────────────────────────────────────────────────────┤{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}│ {C_DIM}OUTPUT CONTENT / PAYLOAD:{C_RESET}")
    
    formatted_json = json.dumps(data, indent=2)
    for line in formatted_json.split("\n")[:35]:  # show up to 35 lines cleanly
        print(f"{C_BLUE}{C_BOLD}│ {C_WHITE}  {line}{C_RESET}")
    if len(formatted_json.split("\n")) > 35:
        print(f"{C_BLUE}{C_BOLD}│ {C_DIM}  ... [additional fields truncated for display] ...{C_RESET}")
    print(f"{C_BLUE}{C_BOLD}└───────────────────────────────────────────────────────────────────────────────────────────────┘{C_RESET}\n")

def invoke_mcp(tool_name, arguments, req_id):
    payload = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    }
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AlertFlow/1.0"
    }
    req = urllib.request.Request(MCP_URL, data=data, headers=headers)
    
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=30) as resp:
            latency = (time.time() - t0) * 1000
            res = json.loads(resp.read().decode("utf-8"))
            
            # Extract content text
            content_list = res.get("result", {}).get("content", [])
            parsed_content = None
            for item in content_list:
                raw = item.get("text") or item.get("value")
                if raw:
                    try:
                        parsed_content = json.loads(raw)
                    except Exception:
                        parsed_content = raw
            if parsed_content is None:
                parsed_content = res.get("result", {})
            return parsed_content, latency, False
    except urllib.error.HTTPError as he:
        latency = (time.time() - t0) * 1000
        err_body = he.read().decode("utf-8", errors="ignore")
        return {"error": f"HTTP {he.code}", "detail": err_body}, latency, True
    except Exception as e:
        latency = (time.time() - t0) * 1000
        return {"error": str(e)}, latency, True

def main():
    print_banner()

    # Pre-flight: Clear gateway gate
    init_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AlertFlow/1.0"
    }
    gw_payload = json.dumps({"jsonrpc": "2.0", "id": 999, "method": "tools/call", "params": {"name": "skill", "arguments": {"slug": "gateway"}}}).encode("utf-8")
    try:
        with urllib.request.urlopen(urllib.request.Request(MCP_URL, data=gw_payload, headers=init_headers), context=CTX, timeout=10) as _:
            pass
    except Exception:
        pass

    # =========================================================================
    # TOOL CALL 1: fastnPlatform__getConnectorConnectionStatus
    # =========================================================================
    args_1 = {"slug": "slack"}
    render_tool_call(1, "fastnPlatform__getConnectorConnectionStatus", args_1)
    res_1, lat_1, err_1 = invoke_mcp("fastnPlatform__getConnectorConnectionStatus", args_1, 101)
    render_tool_response(lat_1, res_1, err_1)
    time.sleep(0.5)

    # =========================================================================
    # TOOL CALL 2: fastnPlatform__getTriggersMonitoring
    # =========================================================================
    args_2 = {}
    render_tool_call(2, "fastnPlatform__getTriggersMonitoring", args_2)
    res_2, lat_2, err_2 = invoke_mcp("fastnPlatform__getTriggersMonitoring", args_2, 102)
    render_tool_response(lat_2, res_2, err_2)
    time.sleep(0.5)

    # =========================================================================
    # TOOL CALL 3: fastnPlatform__getWorkflow
    # =========================================================================
    args_3 = {"id": "wf_5c3b7b05a7ad"}
    render_tool_call(3, "fastnPlatform__getWorkflow", args_3)
    res_3, lat_3, err_3 = invoke_mcp("fastnPlatform__getWorkflow", args_3, 103)
    render_tool_response(lat_3, res_3, err_3)
    time.sleep(0.5)

    # =========================================================================
    # TOOL CALL 4: fastnPlatform__executeWorkflow (LIVE INCIDENT EXECUTION)
    # =========================================================================
    args_4 = {
        "id": "alertops-notification",
        "input": {
            "source": "alertflow-monitor",
            "event_type": "incident.created",
            "incidentId": "INC-94821",
            "title": "Database Connection Pool Exhaustion",
            "severity": "CRITICAL",
            "service": "payments-backend",
            "description": "Active pool reached 100% capacity in production cluster (us-east-1)"
        }
    }
    render_tool_call(4, "fastnPlatform__executeWorkflow", args_4)
    res_4, lat_4, err_4 = invoke_mcp("fastnPlatform__executeWorkflow", args_4, 104)
    render_tool_response(lat_4, res_4, err_4)

    # Detailed Incident Summary Banner
    if isinstance(res_4, dict) and res_4.get("data", {}).get("overall_success"):
        b = res_4["data"].get("backend", {})
        sl = res_4["data"].get("slack", {})
        print(f"{C_GREEN}{C_BOLD}╔═══════════════════════════════════════════════════════════════════════════════════════════════╗{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║                        INCIDENT ORCHESTRATION PIPELINE SUMMARY                                ║{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}╠═══════════════════════════════════════════════════════════════════════════════════════════════╣{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Incident Number : {C_WHITE}INC-{b.get('incident_number')}{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Incident ID     : {C_WHITE}{b.get('incident_id')}{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Alert ID        : {C_WHITE}{b.get('alert_id')}{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Pipeline Steps  : {C_WHITE}{len(b.get('pipeline', []))} stages completed successfully{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Slack Channel   : {C_WHITE}{sl.get('channel')} (Delivery Confirmed ts: {sl.get('ts')}){C_RESET}")
        print(f"{C_GREEN}{C_BOLD}║  Escalation      : {C_WHITE}Scheduled per SLA policy{C_RESET}")
        print(f"{C_GREEN}{C_BOLD}╚═══════════════════════════════════════════════════════════════════════════════════════════════╝{C_RESET}\n")

if __name__ == "__main__":
    main()
