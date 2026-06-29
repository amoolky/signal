const COORD_EPS = 1e-7;
const GEOM_EPS = 1e-9;
const AXIS_EPS = 1e-6;

function normalizeCoord(value) {
  const rounded = Math.round(value / COORD_EPS) * COORD_EPS;
  return Math.abs(rounded) < COORD_EPS ? 0 : rounded;
}

function normalizePoint(point) {
  return { x: normalizeCoord(point.x), y: normalizeCoord(point.y) };
}

function pointsClose(pointA, pointB, eps = COORD_EPS) {
  return Math.abs(pointA.x - pointB.x) <= eps && Math.abs(pointA.y - pointB.y) <= eps;
}

function dedupePoly(poly) {
  const result = [];
  for (const point of poly) {
    const normalized = normalizePoint(point);
    if (result.length === 0 || !pointsClose(result[result.length - 1], normalized)) {
      result.push(normalized);
    }
  }
  if (result.length > 1 && pointsClose(result[0], result[result.length - 1])) {
    result.pop();
  }
  return result;
}

function simplifyPolyOnce(poly) {
  const result = [];
  for (let index = 0; index < poly.length; index += 1) {
    const previousPoint = poly[(index - 1 + poly.length) % poly.length];
    const currentPoint = poly[index];
    const nextPoint = poly[(index + 1) % poly.length];
    const ax = currentPoint.x - previousPoint.x;
    const ay = currentPoint.y - previousPoint.y;
    const bx = nextPoint.x - previousPoint.x;
    const by = nextPoint.y - previousPoint.y;
    const cross = ax * by - ay * bx;
    const scale = Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by), 1);
    if (Math.abs(cross) > Math.max(GEOM_EPS, COORD_EPS * scale)) result.push(currentPoint);
  }
  return result;
}

export function simplifyPoly(poly) {
  let points = dedupePoly(poly);
  let changed = true;

  while (changed && points.length >= 3) {
    const nextPoints = dedupePoly(simplifyPolyOnce(points));
    changed = nextPoints.length !== points.length;
    points = nextPoints;
  }

  return points;
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function pointInPolygon(point, poly) {
  let inside = false;
  for (let index = 0, previousIndex = poly.length - 1; index < poly.length; previousIndex = index, index += 1) {
    const currentPoint = poly[index];
    const previousPoint = poly[previousIndex];
    if (
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function isAxisAligned(poly) {
  for (let index = 0; index < poly.length; index += 1) {
    const pointA = poly[index];
    const pointB = poly[(index + 1) % poly.length];
    if (Math.abs(pointA.x - pointB.x) > AXIS_EPS && Math.abs(pointA.y - pointB.y) > AXIS_EPS) {
      return false;
    }
  }
  return true;
}

function orthogonalizeAxisAlignedPoly(poly) {
  const points = dedupePoly(poly).map((point) => ({ ...point }));
  if (points.length < 3) return points;

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < points.length; index += 1) {
      const nextIndex = (index + 1) % points.length;
      if (Math.abs(points[index].x - points[nextIndex].x) <= AXIS_EPS) {
        const x = normalizeCoord((points[index].x + points[nextIndex].x) / 2);
        points[index].x = x;
        points[nextIndex].x = x;
      } else if (Math.abs(points[index].y - points[nextIndex].y) <= AXIS_EPS) {
        const y = normalizeCoord((points[index].y + points[nextIndex].y) / 2);
        points[index].y = y;
        points[nextIndex].y = y;
      }
    }
  }

  return simplifyPoly(points);
}

function computeGridUnion(polys) {
  const xs = [...new Set(polys.flatMap((poly) => poly.map((point) => point.x)))].sort((a, b) => a - b);
  const ys = [...new Set(polys.flatMap((poly) => poly.map((point) => point.y)))].sort((a, b) => a - b);
  const columnCount = xs.length - 1;
  const rowCount = ys.length - 1;
  if (columnCount <= 0 || rowCount <= 0) return null;

  const filled = Array.from({ length: rowCount }, () => new Array(columnCount).fill(false));
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const center = {
        x: (xs[columnIndex] + xs[columnIndex + 1]) / 2,
        y: (ys[rowIndex] + ys[rowIndex + 1]) / 2,
      };
      for (const poly of polys) {
        if (pointInPolygon(center, poly)) {
          filled[rowIndex][columnIndex] = true;
          break;
        }
      }
    }
  }

  const edgeMap = new Map();

  for (let rowIndex = 0; rowIndex <= rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const below = rowIndex < rowCount ? filled[rowIndex][columnIndex] : false;
      const above = rowIndex > 0 ? filled[rowIndex - 1][columnIndex] : false;
      if (below && !above) {
        edgeMap.set(pointKey({ x: xs[columnIndex], y: ys[rowIndex] }), { x: xs[columnIndex + 1], y: ys[rowIndex] });
      } else if (above && !below) {
        edgeMap.set(pointKey({ x: xs[columnIndex + 1], y: ys[rowIndex] }), { x: xs[columnIndex], y: ys[rowIndex] });
      }
    }
  }

  for (let columnIndex = 0; columnIndex <= columnCount; columnIndex += 1) {
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const right = columnIndex < columnCount ? filled[rowIndex][columnIndex] : false;
      const left = columnIndex > 0 ? filled[rowIndex][columnIndex - 1] : false;
      if (right && !left) {
        edgeMap.set(pointKey({ x: xs[columnIndex], y: ys[rowIndex + 1] }), { x: xs[columnIndex], y: ys[rowIndex] });
      } else if (left && !right) {
        edgeMap.set(pointKey({ x: xs[columnIndex], y: ys[rowIndex] }), { x: xs[columnIndex], y: ys[rowIndex + 1] });
      }
    }
  }

  if (edgeMap.size === 0) return null;

  const visited = new Set();
  const polygons = [];

  for (const startKey of edgeMap.keys()) {
    if (visited.has(startKey)) continue;
    const [x, y] = startKey.split(",").map(Number);
    let currentPoint = { x, y };
    const polygon = [];

    while (true) {
      const key = pointKey(currentPoint);
      if (visited.has(key)) break;
      visited.add(key);
      polygon.push(currentPoint);
      const nextPoint = edgeMap.get(key);
      if (!nextPoint) break;
      currentPoint = nextPoint;
    }

    if (polygon.length >= 3) polygons.push(polygon);
  }

  if (polygons.length !== 1) return null;
  return simplifyPoly(polygons[0]);
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    area += points[index].x * points[nextIndex].y - points[nextIndex].x * points[index].y;
  }
  return area / 2;
}

function ensureClockwise(points) {
  return signedArea(points) >= 0 ? points : [...points].reverse();
}

function removeRepeatedVertices(poly) {
  const result = [];
  for (const point of dedupePoly(poly)) {
    if (!result.some((existingPoint) => pointsClose(existingPoint, point))) {
      result.push(point);
    }
  }
  return result;
}

function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < GEOM_EPS) return null;

  const ex = cx - ax;
  const ey = cy - ay;
  const t = (ex * d2y - ey * d2x) / denominator;
  const u = (ex * d1y - ey * d1x) / denominator;
  if (t <= GEOM_EPS || t >= 1 - GEOM_EPS || u <= GEOM_EPS || u >= 1 - GEOM_EPS) return null;
  return { t, u };
}

function findSelfCrossing(poly) {
  for (let indexA = 0; indexA < poly.length; indexA += 1) {
    const nextIndexA = (indexA + 1) % poly.length;
    const pointA = poly[indexA];
    const pointB = poly[nextIndexA];
    if (pointsClose(pointA, pointB)) continue;

    for (let indexB = indexA + 1; indexB < poly.length; indexB += 1) {
      const nextIndexB = (indexB + 1) % poly.length;
      if (nextIndexA === indexB || nextIndexB === indexA) continue;

      const pointC = poly[indexB];
      const pointD = poly[nextIndexB];
      if (pointsClose(pointC, pointD)) continue;

      if (segmentIntersection(pointA.x, pointA.y, pointB.x, pointB.y, pointC.x, pointC.y, pointD.x, pointD.y)) {
        return { i: indexA, j: indexB };
      }
    }
  }
  return null;
}

function reverseCyclicRange(poly, startIndex, endIndex) {
  const result = poly.map((point) => ({ ...point }));
  const indices = [];
  let cursor = startIndex;

  while (indices.length < poly.length) {
    indices.push(cursor);
    if (cursor === endIndex) break;
    cursor = (cursor + 1) % poly.length;
  }

  const reversed = indices.map((index) => result[index]).reverse();
  indices.forEach((index, reversedIndex) => {
    result[index] = reversed[reversedIndex];
  });
  return result;
}

function sortAroundCentroid(poly) {
  const center = poly.reduce(
    (total, point) => ({
      x: total.x + point.x / poly.length,
      y: total.y + point.y / poly.length,
    }),
    { x: 0, y: 0 },
  );

  return [...poly].sort((pointA, pointB) => {
    const angleA = Math.atan2(pointA.y - center.y, pointA.x - center.x);
    const angleB = Math.atan2(pointB.y - center.y, pointB.x - center.x);
    if (Math.abs(angleA - angleB) > GEOM_EPS) return angleA - angleB;
    const distanceA = (pointA.x - center.x) ** 2 + (pointA.y - center.y) ** 2;
    const distanceB = (pointB.x - center.x) ** 2 + (pointB.y - center.y) ** 2;
    return distanceA - distanceB;
  });
}

function repairSelfIntersections(poly) {
  let points = removeRepeatedVertices(simplifyPoly(poly));
  const maxAttempts = Math.max(points.length * points.length, 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const crossing = findSelfCrossing(points);
    if (!crossing) return points;

    points = removeRepeatedVertices(simplifyPoly(
      reverseCyclicRange(points, (crossing.i + 1) % points.length, crossing.j),
    ));
    if (points.length < 3) return points;
  }

  const sorted = removeRepeatedVertices(simplifyPoly(sortAroundCentroid(points)));
  return sorted.length >= 3 && !findSelfCrossing(sorted) ? sorted : points;
}

export function normalizePoly(poly) {
  let points = removeRepeatedVertices(simplifyPoly(poly));
  if (points.length < 3) return points;

  if (isAxisAligned(points)) {
    points = orthogonalizeAxisAlignedPoly(points);
  }

  points = repairSelfIntersections(points);
  if (points.length < 3) return points;

  if (isAxisAligned(points)) {
    points = orthogonalizeAxisAlignedPoly(points);
  }

  return ensureClockwise(simplifyPoly(points));
}

function makeNode(x, y, alpha = 0) {
  return {
    x,
    y,
    alpha,
    intersect: false,
    entry: false,
    checked: false,
    next: null,
    prev: null,
    neighbor: null,
  };
}

function buildList(points) {
  const nodes = points.map((point) => makeNode(point.x, point.y));
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index].next = nodes[(index + 1) % nodes.length];
    nodes[index].prev = nodes[(index - 1 + nodes.length) % nodes.length];
  }
  return nodes[0];
}

function insertByAlpha(afterNode, newNode) {
  let currentNode = afterNode.next;
  while (currentNode !== afterNode && currentNode.intersect && currentNode.alpha < newNode.alpha) {
    currentNode = currentNode.next;
  }
  newNode.next = currentNode;
  newNode.prev = currentNode.prev;
  currentNode.prev.next = newNode;
  currentNode.prev = newNode;
}

function ghUnion(subjectPoints, clipPoints) {
  const subjectInput = ensureClockwise(subjectPoints);
  const clipInput = ensureClockwise(clipPoints);
  const subject = buildList(subjectInput);
  const clip = buildList(clipInput);

  let hasIntersections = false;
  let subjectNode = subject;
  do {
    if (!subjectNode.intersect) {
      let subjectNextNode = subjectNode.next;
      while (subjectNextNode.intersect) subjectNextNode = subjectNextNode.next;

      let clipNode = clip;
      do {
        if (!clipNode.intersect) {
          let clipNextNode = clipNode.next;
          while (clipNextNode.intersect) clipNextNode = clipNextNode.next;

          const intersection = segmentIntersection(
            subjectNode.x,
            subjectNode.y,
            subjectNextNode.x,
            subjectNextNode.y,
            clipNode.x,
            clipNode.y,
            clipNextNode.x,
            clipNextNode.y,
          );

          if (intersection) {
            hasIntersections = true;
            const x = subjectNode.x + intersection.t * (subjectNextNode.x - subjectNode.x);
            const y = subjectNode.y + intersection.t * (subjectNextNode.y - subjectNode.y);
            const subjectIntersection = makeNode(x, y, intersection.t);
            const clipIntersection = makeNode(x, y, intersection.u);
            subjectIntersection.intersect = true;
            clipIntersection.intersect = true;
            subjectIntersection.neighbor = clipIntersection;
            clipIntersection.neighbor = subjectIntersection;
            insertByAlpha(subjectNode, subjectIntersection);
            insertByAlpha(clipNode, clipIntersection);
          }
        }
        clipNode = clipNode.next;
      } while (clipNode !== clip);
    }
    subjectNode = subjectNode.next;
  } while (subjectNode !== subject);

  if (!hasIntersections) {
    if (pointInPolygon({ x: subjectInput[0].x, y: subjectInput[0].y }, clipInput)) return clipInput;
    if (pointInPolygon({ x: clipInput[0].x, y: clipInput[0].y }, subjectInput)) return subjectInput;
    return null;
  }

  let inside = pointInPolygon({ x: subject.x, y: subject.y }, clipInput);
  let currentNode = subject;
  do {
    if (currentNode.intersect) {
      currentNode.entry = !inside;
      inside = !inside;
    }
    currentNode = currentNode.next;
  } while (currentNode !== subject);

  inside = pointInPolygon({ x: clip.x, y: clip.y }, subjectInput);
  currentNode = clip;
  do {
    if (currentNode.intersect) {
      currentNode.entry = !inside;
      inside = !inside;
    }
    currentNode = currentNode.next;
  } while (currentNode !== clip);

  let startNode = null;
  currentNode = subject;
  do {
    if (currentNode.intersect && !currentNode.entry && !currentNode.checked) {
      startNode = currentNode;
      break;
    }
    currentNode = currentNode.next;
  } while (currentNode !== subject);

  if (!startNode) return null;

  const result = [];
  const maxSteps = (subjectInput.length + clipInput.length + 20) * 4;
  currentNode = startNode;
  startNode.checked = true;
  let onSubject = true;

  for (let step = 0; step < maxSteps; step += 1) {
    result.push({ x: currentNode.x, y: currentNode.y });
    currentNode = currentNode.next;
    if (currentNode === startNode) break;

    if (currentNode.intersect) {
      if (onSubject && currentNode.entry) {
        currentNode.checked = true;
        currentNode = currentNode.neighbor;
        currentNode.checked = true;
        onSubject = false;
      } else if (!onSubject && currentNode.entry) {
        currentNode.checked = true;
        currentNode = currentNode.neighbor;
        currentNode.checked = true;
        onSubject = true;
        if (currentNode === startNode) break;
      }
    }
  }

  return result.length >= 3 ? result : null;
}

function edgeKey(fromPoint, toPoint) {
  return `${pointKey(fromPoint)}|${pointKey(toPoint)}`;
}

function sharedEdgeUnion(polyA, polyB) {
  const boundary = new Map();
  let removedSharedEdge = false;

  const addEdge = (fromPoint, toPoint) => {
    const reverseKey = edgeKey(toPoint, fromPoint);
    if (boundary.has(reverseKey)) {
      boundary.delete(reverseKey);
      removedSharedEdge = true;
      return true;
    }

    const key = edgeKey(fromPoint, toPoint);
    if (boundary.has(key)) return false;
    boundary.set(key, { from: fromPoint, to: toPoint });
    return true;
  };

  for (const poly of [polyA, polyB]) {
    for (let index = 0; index < poly.length; index += 1) {
      if (!addEdge(poly[index], poly[(index + 1) % poly.length])) return null;
    }
  }

  if (!removedSharedEdge || boundary.size < 3) return null;

  const outgoing = new Map();
  const incomingCount = new Map();

  for (const edge of boundary.values()) {
    const fromKey = pointKey(edge.from);
    const toKey = pointKey(edge.to);
    const edges = outgoing.get(fromKey) ?? [];
    edges.push(edge);
    outgoing.set(fromKey, edges);
    incomingCount.set(toKey, (incomingCount.get(toKey) ?? 0) + 1);
  }

  for (const edges of outgoing.values()) {
    if (edges.length !== 1) return null;
  }

  for (const count of incomingCount.values()) {
    if (count !== 1) return null;
  }

  const visited = new Set();
  const polygons = [];

  for (const startEdge of boundary.values()) {
    const startEdgeKey = edgeKey(startEdge.from, startEdge.to);
    if (visited.has(startEdgeKey)) continue;

    const startPointKey = pointKey(startEdge.from);
    const polygon = [];
    let edge = startEdge;
    let closed = false;

    while (polygon.length <= boundary.size) {
      const key = edgeKey(edge.from, edge.to);
      if (visited.has(key)) return null;
      visited.add(key);
      polygon.push(edge.from);

      const nextPointKey = pointKey(edge.to);
      if (nextPointKey === startPointKey) {
        closed = true;
        break;
      }

      const nextEdges = outgoing.get(nextPointKey);
      if (!nextEdges || nextEdges.length !== 1) return null;
      edge = nextEdges[0];
    }

    if (!closed || polygon.length < 3) return null;
    polygons.push(polygon);
  }

  if (visited.size !== boundary.size || polygons.length !== 1) return null;
  const result = normalizePoly(polygons[0]);
  return result.length >= 3 ? result : null;
}

export function computeUnion(polys) {
  const normalizedPolys = polys.map(normalizePoly);

  if (normalizedPolys.length === 0 || normalizedPolys.some((poly) => poly.length < 3)) return null;
  if (normalizedPolys.length === 1) return normalizedPolys[0];

  if (normalizedPolys.every(isAxisAligned)) {
    const gridUnion = computeGridUnion(normalizedPolys.map(orthogonalizeAxisAlignedPoly));
    return gridUnion ? normalizePoly(gridUnion) : null;
  }

  let result = normalizedPolys[0];
  for (let index = 1; index < normalizedPolys.length; index += 1) {
    const next = ghUnion(normalizePoly(result), normalizedPolys[index]);
    if (next === null) {
      const stitched = sharedEdgeUnion(normalizePoly(result), normalizedPolys[index]);
      if (stitched === null) return null;
      result = stitched;
    } else {
      result = normalizePoly(next);
    }
  }
  return normalizePoly(result);
}
