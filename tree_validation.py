"""Strict publication checks for normalized Medi-Tree graphs."""
from collections import deque
from math import isfinite


def publication_errors(tree):
    nodes = {n['id']: n for n in tree['nodes']}
    root = tree['rootNodeId']
    if root not in nodes:
        return ['Missing root node.']
    outgoing = {n: [] for n in nodes}
    indegree = dict.fromkeys(nodes, 0)
    errors = []
    for edge in tree['edges']:
        a, b = edge['source'], edge['target']
        if a not in nodes or b not in nodes:
            errors.append('Edge references missing node.')
            continue
        outgoing[a].append(edge)
        indegree[b] += 1
    for key, node in nodes.items():
        branches = outgoing[key]
        if not all(isfinite(node['position'][axis]) for axis in ('x', 'y')):
            errors.append(f'{key}: non-finite position.')
        if node['type'] == 'question' and not branches:
            errors.append(f'{key}: question has no branches.')
        if node['type'] == 'outcome' and branches:
            errors.append(f'{key}: outcome has outgoing branches.')
        labels = [e['label'].strip().casefold() for e in branches]
        if '' in labels or len(labels) != len(set(labels)):
            errors.append(f'{key}: blank or duplicate branch labels.')
    seen, queue = {root}, deque([root])
    while queue:
        for edge in outgoing[queue.popleft()]:
            target = edge['target']
            if target not in seen:
                seen.add(target)
                queue.append(target)
    if set(nodes) - seen:
        errors.append('Unreachable nodes: ' + ', '.join(sorted(set(nodes) - seen)))
    queue = deque(n for n in nodes if not indegree[n])
    visited = 0
    while queue:
        visited += 1
        for edge in outgoing[queue.popleft()]:
            target = edge['target']
            indegree[target] -= 1
            if not indegree[target]:
                queue.append(target)
    if visited != len(nodes):
        errors.append('Workflow contains a cycle.')
    return errors
