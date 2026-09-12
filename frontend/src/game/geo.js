import "./bjs.js";
// game/geo.js — 几何累加器，自己写，不用 MeshBuilder 造上万个 mesh
// 一个 tile 一个 GeoBatch，toMesh 时合并成一个 Mesh

export class GeoBatch {
  constructor() {
    this.pos = []; // x,y,z
    this.nrm = []; // nx,ny,nz
    this.uv = [];  // u,v
    this.col = []; // r,g,b,a
    this.idx = []; // indices
    this._vCount = 0;
  }

  // 内部：推一个顶点
  _pushVert(x, y, z, nx, ny, nz, u, v, r, g, b, a = 1) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(r, g, b, a);
    return this._vCount++;
  }

  // 推一个四边形 p0,p1,p2,p3 (逆时针)，atlasRect {u0,v0,u1,v1}，tint [r,g,b]，normal [nx,ny,nz]，uvScale {u,v}
  addQuad(p0, p1, p2, p3, atlasRect, tintRGB, normal = null, uvScale = null) {
    const rect = atlasRect || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const tint = tintRGB || [1, 1, 1];
    const r = tint[0], g = tint[1], b = tint[2];

    // 计算法线
    let nx, ny, nz;
    if (normal) {
      nx = normal[0]; ny = normal[1]; nz = normal[2];
    } else {
      // p0->p1, p0->p3 cross
      const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
      const vx = p3.x - p0.x, vy = p3.y - p0.y, vz = p3.z - p0.z;
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
    }

    const uScale = (uvScale && uvScale.u) || 1;
    const vScale = (uvScale && uvScale.v) || 1;

    // local UV: p0=(0,0), p1=(1,0), p2=(1,1), p3=(0,1) with scale and fract for tiling inside atlas cell
    const uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];

    const verts = [];
    const points = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      let lu = uvs[i][0] * uScale;
      let lv = uvs[i][1] * vScale;
      // fract for tiling inside atlas cell
      lu = lu - Math.floor(lu);
      lv = lv - Math.floor(lv);
      // handle exactly 1.0 -> 1.0 not 0
      if (uvs[i][0] * uScale % 1 === 0 && uvs[i][0] !== 0) lu = 1;
      if (uvs[i][1] * vScale % 1 === 0 && uvs[i][1] !== 0) lv = 1;

      const u = rect.u0 + (rect.u1 - rect.u0) * lu;
      const v = rect.v0 + (rect.v1 - rect.v0) * lv;
      const idx = this._pushVert(points[i].x, points[i].y, points[i].z, nx, ny, nz, u, v, r, g, b, 1);
      verts.push(idx);
    }
    // 两个三角
    this.idx.push(verts[0], verts[1], verts[2]);
    this.idx.push(verts[0], verts[2], verts[3]);
  }

  // 添加盒子 cx,cy,cz 中心，sx,sy,sz 尺寸，yaw 绕 Y 弧度，atlasRect，tintRGB，opts {uScale,vScale, topRect, bottomRect, sideRect}
  addBox(cx, cy, cz, sx, sy, sz, yaw = 0, atlasRect = null, tintRGB = null, opts = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);

    const rotate = (x, z) => {
      return {
        x: x * cos - z * sin,
        z: x * sin + z * cos,
      };
    };

    // 8 个角（未旋转，相对中心）
    const corners = [
      { x: -hx, y: -hy, z: -hz }, // 0
      { x: hx, y: -hy, z: -hz },  // 1
      { x: hx, y: -hy, z: hz },   // 2
      { x: -hx, y: -hy, z: hz },  // 3
      { x: -hx, y: hy, z: -hz },  // 4
      { x: hx, y: hy, z: -hz },   // 5
      { x: hx, y: hy, z: hz },    // 6
      { x: -hx, y: hy, z: hz },   // 7
    ].map(p => {
      const r = rotate(p.x, p.z);
      return { x: cx + r.x, y: cy + p.y, z: cz + r.z };
    });

    // 法线（旋转后）
    const rotNormal = (nx, nz) => {
      const r = rotate(nx, nz);
      return [r.x, 0, r.z];
    };

    const topRect = opts.topRect || atlasRect;
    const bottomRect = opts.bottomRect || atlasRect;
    const sideRect = opts.sideRect || atlasRect;

    const uScale = opts.uScale || 1;
    const vScale = opts.vScale || 1;

    // 顶面 +Y
    this.addQuad(corners[7], corners[6], corners[5], corners[4], topRect, tintRGB, [0, 1, 0], { u: uScale, v: uScale });
    // 底面 -Y
    this.addQuad(corners[3], corners[0], corners[1], corners[2], bottomRect, tintRGB, [0, -1, 0], { u: uScale, v: uScale });
    // 前面 +Z (z+)
    this.addQuad(corners[3], corners[2], corners[6], corners[7], sideRect, tintRGB, rotNormal(0, 1), { u: opts.uScale || 1, v: opts.vScale || 1 });
    // 后面 -Z
    this.addQuad(corners[1], corners[0], corners[4], corners[5], sideRect, tintRGB, rotNormal(0, -1), { u: opts.uScale || 1, v: opts.vScale || 1 });
    // 右面 +X
    this.addQuad(corners[2], corners[1], corners[5], corners[6], sideRect, tintRGB, rotNormal(1, 0), { u: opts.uScale || 1, v: opts.vScale || 1 });
    // 左面 -X
    this.addQuad(corners[0], corners[3], corners[7], corners[4], sideRect, tintRGB, rotNormal(-1, 0), { u: opts.uScale || 1, v: opts.vScale || 1 });
  }

  // 圆柱：垂直，中心底面 cx,cz，底面 y=cy，半径 r，高度 h，分段 seg
  addCylinder(cx, cy, cz, r, h, seg = 8, atlasRect = null, tintRGB = null) {
    const rect = atlasRect || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const tint = tintRGB || [1, 1, 1];
    // 侧面：seg 个四边形
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const p0 = { x: x0, y: cy, z: z0 };
      const p1 = { x: x1, y: cy, z: z1 };
      const p2 = { x: x1, y: cy + h, z: z1 };
      const p3 = { x: x0, y: cy + h, z: z0 };
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      this.addQuad(p0, p1, p2, p3, rect, tint, [nx, 0, nz]);
    }
    // 顶面和底面用三角扇近似为多边形（简化为中心点+边）
    // 底面
    const bottomCenter = { x: cx, y: cy, z: cz };
    const topCenter = { x: cx, y: cy + h, z: cz };
    // 底面多边形：用 seg 个三角
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const p0 = bottomCenter;
      const p1 = { x: x0, y: cy, z: z0 };
      const p2 = { x: x1, y: cy, z: z1 };
      // 手动推三角
      const v0 = this._pushVert(p0.x, p0.y, p0.z, 0, -1, 0, rect.u0 + (rect.u1 - rect.u0) * 0.5, rect.v0 + (rect.v1 - rect.v0) * 0.5, tint[0], tint[1], tint[2], 1);
      const v1 = this._pushVert(p1.x, p1.y, p1.z, 0, -1, 0, rect.u0 + (rect.u1 - rect.u0) * (0.5 + Math.cos(a0) * 0.5), rect.v0 + (rect.v1 - rect.v0) * (0.5 + Math.sin(a0) * 0.5), tint[0], tint[1], tint[2], 1);
      const v2 = this._pushVert(p2.x, p2.y, p2.z, 0, -1, 0, rect.u0 + (rect.u1 - rect.u0) * (0.5 + Math.cos(a1) * 0.5), rect.v0 + (rect.v1 - rect.v0) * (0.5 + Math.sin(a1) * 0.5), tint[0], tint[1], tint[2], 1);
      this.idx.push(v0, v1, v2);
    }
    // 顶面
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const p0 = topCenter;
      const p1 = { x: x1, y: cy + h, z: z1 };
      const p2 = { x: x0, y: cy + h, z: z0 };
      const v0 = this._pushVert(p0.x, p0.y, p0.z, 0, 1, 0, rect.u0 + (rect.u1 - rect.u0) * 0.5, rect.v0 + (rect.v1 - rect.v0) * 0.5, tint[0], tint[1], tint[2], 1);
      const v1 = this._pushVert(p1.x, p1.y, p1.z, 0, 1, 0, rect.u0 + (rect.u1 - rect.u0) * (0.5 + Math.cos(a1) * 0.5), rect.v0 + (rect.v1 - rect.v0) * (0.5 + Math.sin(a1) * 0.5), tint[0], tint[1], tint[2], 1);
      const v2 = this._pushVert(p2.x, p2.y, p2.z, 0, 1, 0, rect.u0 + (rect.u1 - rect.u0) * (0.5 + Math.cos(a0) * 0.5), rect.v0 + (rect.v1 - rect.v0) * (0.5 + Math.sin(a0) * 0.5), tint[0], tint[1], tint[2], 1);
      this.idx.push(v0, v1, v2);
    }
  }

  // 合并到 Mesh（需要 Babylon Scene）
  toMesh(scene, name = "cityTile") {
    if (!scene) return null;
    // 动态 import Babylon 以避免 Node 环境崩溃
    // 这里假设全局已加载 Babylon，或者通过 scene.getEngine()
    // 我们直接使用 scene 上的 VertexData 构造
    let VertexData, Mesh;
    try {
      // 尝试从全局或通过动态方式获取
      // 在 esm 环境，@babylonjs/core 已被 main.js import，但我们这里直接使用 scene 的构造器
      // 使用 BABYLON 的 VertexData 若存在
      if (typeof window !== 'undefined' && window.BABYLON && window.BABYLON.VertexData) {
        VertexData = window.BABYLON.VertexData;
        Mesh = window.BABYLON.Mesh;
      } else {
        // 尝试 import（同步不现实，退回用 scene 自带的）
        // 我们直接构造一个简易 mesh via new Mesh
        const { Mesh: BMesh } = require ? require("@babylonjs/core/Meshes/mesh") : {};
        // fallback
      }
    } catch (e) {}

    // 如果没有 VertexData，我们尝试用 @babylonjs/core 的导入（在浏览器环境下 build.mjs 已打包，会包含）
    // 这里直接使用动态创建：若 scene 有可用方法，手动创建
    try {
      // 尝试使用 Babylon 的 VertexData（通过 global）
      const vd = new (scene.getEngine ? scene.getEngine().constructor : null) ? null : null;
    } catch (e) {}

    // 最简实现：直接使用 Mesh 和 VertexData（若未导入，尝试从 window 获取）
    // 由于我们在前端打包，@babylonjs/core 的 Mesh 和 VertexData 会被包含，我们直接 import 静态
    // 但为避免循环依赖，我们在函数内部动态 import（浏览器支持）
    // 这里我们采用直接构造：返回一个对象，实际在 city.js 里用 scene 的 API 创建

    // 为了让 build.mjs 能打包，我们在文件顶部不 import，而是在 city.js 里处理 toMesh 的 Babylon 依赖
    // 这里我们仅返回数据，city.js 负责创建 Mesh
    return {
      positions: this.pos,
      normals: this.nrm,
      uvs: this.uv,
      colors: this.col,
      indices: this.idx,
      vertexCount: this._vCount,
    };
  }

  // 真正创建 Babylon Mesh 的静态辅助（在 city.js 中调用）
  static createMeshFromData(scene, data, name, material) {
    // 动态获取 Babylon Mesh 和 VertexData
    // 由于我们不能在这里直接 import（避免 Node 崩），我们尝试通过 scene 构造
    // 使用 global BABYLON if available, otherwise use @babylonjs/core via dynamic import is handled in city.js
    // 这里提供一个通用实现：若 window.BABYLON 存在则用它，否则尝试 import
    let Mesh, VertexData;
    try {
      // 在浏览器打包环境，BABYLON 通常挂在 window
      if (typeof window !== 'undefined' && window.BABYLON) {
        Mesh = window.BABYLON.Mesh;
        VertexData = window.BABYLON.VertexData;
      }
    } catch (e) {}

    if (!Mesh || !VertexData) {
      // 退化：尝试从 @babylonjs/core 获取（在打包后，import 会被包含）
      // 这里我们直接使用 scene 的原型链：scene 有一个方法可以创建 mesh
      // 我们用最原始的方式：new Mesh
      try {
        // eslint-disable-next-line no-undef
        const core = require("@babylonjs/core");
        Mesh = core.Mesh;
        VertexData = core.VertexData;
      } catch (e) {
        // 最后尝试：使用 global 的 BABYLON
      }
    }

    if (Mesh && VertexData) {
      const mesh = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = data.positions;
      vd.normals = data.normals;
      vd.uvs = data.uvs;
      vd.colors = data.colors;
      vd.indices = data.indices;
      vd.applyToMesh(mesh, false);
      if (material) mesh.material = material;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = true;
      return mesh;
    } else {
      // 退化：直接创建一个空 mesh 并手动设置（适用于测试环境）
      return null;
    }
  }

  getStats() {
    return {
      vertices: this._vCount,
      triangles: this.idx.length / 3,
      positionsBytes: this.pos.length * 4,
    };
  }

  clear() {
    this.pos.length = 0;
    this.nrm.length = 0;
    this.uv.length = 0;
    this.col.length = 0;
    this.idx.length = 0;
    this._vCount = 0;
  }
}
