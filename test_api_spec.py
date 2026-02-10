
import urllib.request
import urllib.error
import json
import time

BASE_URL = "http://localhost:3000/api"
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer dev-token-1234"
}

def post(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers=HEADERS,
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.getcode(), json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 500, str(e)

def test_get_symbol():
    print("\n--- Testing Symbol Get ---")
    payload = {"qualified_name": "C:/Workspace/ProjectAnalyzer/src/server/api-server.ts#ApiServer"}
    code, data = post(f"{BASE_URL}/symbol/get", payload)
    
    if code == 200:
        print("SUCCESS")
        # print(json.dumps(data, indent=2))
        return True
    else:
        print(f"FAILED: {code}")
        print(data)
        return False

def test_impact_analysis():
    print("\n--- Testing Impact Analysis ---")
    payload = {
        "symbol": {"qualified_name": "C:/Workspace/ProjectAnalyzer/src/graph/graph-engine.ts#GraphEngine"},
        "max_depth": 3
    }
    code, data = post(f"{BASE_URL}/analysis/impact", payload)

    if code == 200:
        if "affected_nodes" in data and isinstance(data["affected_nodes"], list):
            print("SUCCESS: 'affected_nodes' key exists")
            if len(data["affected_nodes"]) > 0:
                first_node = data["affected_nodes"][0]
                if "impact_path" in first_node and isinstance(first_node["impact_path"], list):
                     print("SUCCESS: Correct structure with 'impact_path'")
                     print(f"Found {len(data['affected_nodes'])} affected nodes")
                     print(f"Example impact path: {first_node['impact_path']}")
                else:
                    print("FAILED: 'impact_path' missing or invalid")
                    print(json.dumps(first_node, indent=2))
            else:
                print("SUCCESS: Correct structure (empty list)")
            return True
        else:
            print("FAILED: 'affected_nodes' key missing or invalid")
            print(json.dumps(data, indent=2))
            return False
    else:
        print(f"FAILED: {code}")
        print(data)
        return False

def test_get_callers():
    print("\n--- Testing Get Callers ---")
    # Using forward slashes for path
    payload = {
        "symbol": {"qualified_name": "C:/Workspace/ProjectAnalyzer/src/graph/graph-engine.ts#GraphEngine"},
        "max_depth": 1
    }
    code, data = post(f"{BASE_URL}/graph/callers", payload)

    if code == 200:
        if "callers" in data and isinstance(data["callers"], list):
            print("SUCCESS: 'callers' key exists")
            if len(data["callers"]) > 0:
                first_caller = data["callers"][0]
                if "node" in first_caller and "distance" in first_caller:
                    print("SUCCESS: Correct structure with 'node' and 'distance'")
                else:
                    print("FAILED: Invalid caller structure")
                    print(json.dumps(first_caller, indent=2))
            else:
                print("SUCCESS: Correct structure (empty list)")
            return True
        else:
            print("FAILED: 'callers' key missing")
            print(json.dumps(data, indent=2))
            return False
    else:
        print(f"FAILED: {code}")
        print(data)
        return False

def test_search_symbol():
    print("\n--- Testing Symbol Search (Debug) ---")
    payload = {"query": "ApiServer", "limit": 5}
    code, data = post(f"{BASE_URL}/search/symbols", payload)
    
    if code == 200:
        print("Search Results:")
        # print(json.dumps(data, indent=2))
        if "matches" in data:
            for match in data["matches"]:
                print(f"Found: {match['symbol']['qualified_name']}")
            return True
        return False
    else:
        print(f"FAILED: {code}")
        print(data)
        return False

if __name__ == "__main__":
    test_search_symbol()
    if test_get_symbol():
        test_impact_analysis()
        test_get_callers()
