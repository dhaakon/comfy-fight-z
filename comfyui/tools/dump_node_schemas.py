"""Add CFZ node schemas missing from comfyui/workflows/templates/compact-factory-schema.json.

The workflow generators build graphs from this object_info-format snapshot, so new CFZ nodes can
appear in templates without a running server. Existing entries are kept as they are (a live
server reports machine-specific defaults such as local folders); pass node IDs to refresh them.
Run with an installed ComfyUI's Python:
  COMFYUI_ROOT=<ComfyUI folder> <ComfyUI python> comfyui/tools/dump_node_schemas.py [NodeId ...]
"""
import json
import os
import sys

COMFY = os.environ["COMFYUI_ROOT"]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, COMFY)
sys.path.insert(0, os.path.join(REPO, "comfyui", "custom_nodes"))
os.chdir(COMFY)

from comfy_fighter_assets.factories import FACTORY_NODES  # noqa: E402
from comfy_fighter_assets.scenery import SCENERY_NODES  # noqa: E402

target = os.path.join(REPO, "comfyui", "workflows", "templates", "compact-factory-schema.json")
with open(target, encoding="utf-8") as file:
    schemas = json.load(file)
refresh, added = set(sys.argv[1:]), []
for node in [*FACTORY_NODES, *SCENERY_NODES]:
    node_id = node.define_schema().node_id
    if node_id in schemas and node_id not in refresh:
        continue
    info = json.loads(json.dumps(node.GET_NODE_INFO_V1(), default=str))
    info["python_module"] = "custom_nodes.comfy_fighter_assets"
    schemas[node_id] = info; added.append(node_id)
with open(target, "w", encoding="utf-8", newline="\n") as file:
    file.write(json.dumps(schemas, indent=2) + "\n")
print(f"Added or refreshed {len(added)} schema(s): {', '.join(added) or 'none'}")
