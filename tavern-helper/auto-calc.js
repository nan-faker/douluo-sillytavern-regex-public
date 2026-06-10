// @name         [助手]斗罗大陆 I-IV · Soul Land 自动计算脚本 @0.4.7
// @module       tavern-helper/auto-calc
// @version      @0.4.7
// @source       tavern-helper-scripts/auto-calc/dist/latest.json
"use strict";

(function () {
    'use strict';

    const SCRIPT_NAME = '斗罗V0.3自动计算脚本';
    const VERSION = '0.4.4';
    const STORAGE_KEY = 'douluo_v03_auto_calc_enabled';
    const EXTREME_ATTACK_MULTIPLIER = 1.5;

    const CONFIG = {
        debug: false,
        autoIntervalMs: 30000,
        refreshAfterWrite: true,
        defaults: {
            baseAttr: 1,
            lifeCoef: 1,
            mpGrowth: 10,
            spiritGrowth: 10,
            baseSp: 1000000,
            baseDp: 100,
        },
        tables: {
            player: '玩家状态与信息',
            stats: '人物综合数值面板',
            traits: '玩家天赋与特性表',
            traitState: '已选特性状态表',
            traitRules: '特性规则扩展表',
            traitAttributeRules: '特性属性改写规则表',
            traitEquipmentSlots: '特性装备栏扩展表',
            traitTempStates: '特性临时状态与乘区表',
            skills: '玩家通用技能',
            soulOverview: '武魂总览表',
            rings: ['第一武魂', '第二武魂', '第三武魂'],
            soulBones: '魂骨与魂核面板',
            spirits: '魂灵表',
            armor: '斗铠表',
            soulDevices: '魂导器表',
            titlePanel: '称号面板',
            titleLibrary: '称号库',
            notes: '纪要表',
            npcs: '重要NPC档案表',
        },
    };

    const REQUIRED_TEMPLATE_TABLES = Object.freeze(Object.values(CONFIG.tables).flat().filter(Boolean));

    const CORE_RECALC_TABLES = Object.freeze([
        CONFIG.tables.player,
        CONFIG.tables.stats,
        CONFIG.tables.soulOverview,
    ]);

    const QUALITY = [
        { key: '超神级', level: 30, multiplier: 5.0, exp: '500%' },
        { key: '神级', level: 20, multiplier: 3.0, exp: '300%' },
        { key: '顶级', level: 10, multiplier: 2.0, exp: '200%' },
        { key: '高级', level: 7, multiplier: 1.6, exp: '150%' },
        { key: '中级', level: 5, multiplier: 1.3, exp: '100%' },
        { key: '低级', level: 3, multiplier: 1.1, exp: '80%' },
        { key: '废武魂', level: 1, multiplier: 1.0, exp: '50%' },
        { key: '废', level: 1, multiplier: 1.0, exp: '50%' },
    ];

    const RING_TYPE_SCALE = [
        { test: /肉身|肉体|强攻|防御|体魄/, body: 1, soul: 0.25, mind: 0.1, name: '肉身型' },
        { test: /能量|魂力|元素|爆发|远程/, body: 0.25, soul: 1, mind: 0.5, name: '能量型' },
        { test: /精神|灵魂|幻|念|感知/, body: 0.1, soul: 0.5, mind: 1, name: '精神型' },
        { test: /控制|束缚|限制|封印/, body: 0.25, soul: 0.75, mind: 0.75, name: '控制型' },
        { test: /生命|辅助|治疗|恢复|增益/, body: 0.5, soul: 0.75, mind: 0.5, name: '生命/辅助型' },
        { test: /均衡|平衡|泛用/, body: 0.5, soul: 0.5, mind: 0.5, name: '均衡型' },
    ];

    let api = null;
    let timer = null;
    let isWriting = false;
    let lastInputHash = '';

    function log(...args) {
        if (CONFIG.debug) console.log(`[${SCRIPT_NAME}]`, ...args);
    }

    function toast(message, type = 'info') {
        const t = window.toastr;
        if (t && typeof t[type] === 'function') t[type](message, SCRIPT_NAME);
        else console.log(`[${SCRIPT_NAME}][${type}]`, message);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function hostWindows() {
        const list = [window];
        try {
            if (window.parent && window.parent !== window) list.push(window.parent);
        } catch (_) {}
        try {
            if (window.top && !list.includes(window.top)) list.push(window.top);
        } catch (_) {}
        return list;
    }

    function getHostGlobal(name) {
        for (const host of hostWindows()) {
            try {
                if (host && host[name] !== undefined && host[name] !== null) return host[name];
            } catch (_) {}
        }
        return null;
    }

    function getDatabaseApi() {
        return getHostGlobal('AutoCardUpdaterAPI');
    }

    async function waitForDatabaseApi(timeoutMs = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const found = getDatabaseApi();
            if (found) return found;
            await sleep(500);
        }
        return null;
    }

    function asText(value) {
        if (value === undefined || value === null) return '';
        return String(value).trim();
    }

    function yes(value) {
        const text = asText(value);
        return /^(是|启用|已启用|显示|已显示|true|yes|y|1)$/i.test(text);
    }

    function no(value) {
        const text = asText(value);
        return /^(否|禁用|未启用|隐藏|未显示|false|no|n|0)$/i.test(text);
    }

    function empty(value) {
        const text = asText(value);
        return !text || /^(无|空|未定|待定|待填写|null|undefined|-|0\/0)$/i.test(text);
    }

    function num(value, fallback = 0) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
        const text = asText(value).replace(/,/g, '');
        if (!text) return fallback;
        const match = text.match(/-?\d+(?:\.\d+)?/);
        if (!match) return fallback;
        const n = Number(match[0]);
        return Number.isFinite(n) ? n : fallback;
    }

    function round(value, digits = 2) {
        const factor = Math.pow(10, digits);
        return Math.round((Number(value) || 0) * factor) / factor;
    }

    function bonus(body = 0, soul = 0, mind = 0) {
        return { body, soul, mind };
    }

    function resBonus(hp = 0, mp = 0, spirit = 0) {
        return { hp, mp, spirit };
    }

    function addTri(target, source, scale = 1) {
        target.body += (Number(source.body) || 0) * scale;
        target.soul += (Number(source.soul) || 0) * scale;
        target.mind += (Number(source.mind) || 0) * scale;
        return target;
    }

    function addRes(target, source, scale = 1) {
        target.hp += (Number(source.hp) || 0) * scale;
        target.mp += (Number(source.mp) || 0) * scale;
        target.spirit += (Number(source.spirit) || 0) * scale;
        return target;
    }

    function stableHash(value) {
        const seen = new WeakSet();
        const text = JSON.stringify(value, (key, val) => {
            if (key === '__raw' || key === '__rowIndex') return undefined;
            if (key && /_脚本$/.test(key)) return undefined;
            if (key === '计算备注' || key === '加成计算备注' || key === '战力标尺定位_脚本') return undefined;
            if (val && typeof val === 'object') {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
                if (!Array.isArray(val)) {
                    return Object.keys(val).sort().reduce((out, k) => {
                        out[k] = val[k];
                        return out;
                    }, {});
                }
            }
            return val;
        });
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function getSheet(db, tableName) {
        if (!db || !tableName) return null;
        if (db[tableName]) return db[tableName];
        for (const [key, value] of Object.entries(db)) {
            if (key === tableName) return value;
            if (value && typeof value === 'object' && value.name === tableName) return value;
        }
        if (Array.isArray(db.tables)) {
            return db.tables.find(t => t && (t.name === tableName || t.uid === tableName)) || null;
        }
        return null;
    }

    function missingTables(db, tableNames = REQUIRED_TEMPLATE_TABLES) {
        return tableNames.filter(tableName => !getSheet(db, tableName));
    }

    function databaseRepairHint(missing) {
        const listed = missing.slice(0, 6).join('、');
        const suffix = missing.length > 6 ? ` 等${missing.length}张表` : '';
        return `数据库模板/同步状态不完整，缺少：${listed}${suffix}。请重新注入最新 24 表 TavernDB 模板，执行数据清洗后调用 refreshDataAndWorldbook()，再手动重算。`;
    }

    function verifyDatabaseReady(db, tableNames = CORE_RECALC_TABLES) {
        const missing = missingTables(db, tableNames);
        if (!missing.length) return { ok: true, missing: [], message: '' };
        return { ok: false, missing, message: databaseRepairHint(missing) };
    }

    function rowToObject(headers, row, rowIndex) {
        const out = { __rowIndex: rowIndex, __raw: row };
        headers.forEach((header, index) => {
            out[header] = Array.isArray(row) ? row[index] : row?.[header];
        });
        return out;
    }

    function rowsFromSheet(sheet) {
        if (!sheet) return [];
        if (Array.isArray(sheet)) {
            if (!sheet.length) return [];
            if (Array.isArray(sheet[0])) {
                const headers = sheet[0].map(asText);
                return sheet.slice(1).map((row, idx) => rowToObject(headers, row, idx + 1));
            }
            return sheet.map((row, idx) => ({ ...row, __rowIndex: idx + 1 }));
        }
        if (Array.isArray(sheet.content)) {
            if (!sheet.content.length) return [];
            const headers = sheet.content[0].map(asText);
            return sheet.content.slice(1).map((row, idx) => rowToObject(headers, row, idx + 1));
        }
        if (Array.isArray(sheet.rows)) return sheet.rows.map((row, idx) => ({ ...row, __rowIndex: idx + 1 }));
        if (Array.isArray(sheet.data)) return sheet.data.map((row, idx) => ({ ...row, __rowIndex: idx + 1 }));
        return [];
    }

    function rows(db, tableName) {
        return rowsFromSheet(getSheet(db, tableName));
    }

    function firstRow(db, tableName) {
        return rows(db, tableName)[0] || {};
    }

    const COLUMN_ALIASES = {
        'row_id': ['行编号'],
        '行编号': ['row_id'],
        '槽位ID': ['槽位编号'],
        '槽位编号': ['槽位ID'],
        '其他Buff': ['其他增减益'],
        '其他增减益': ['其他Buff'],
        '特性点': ['剩余SP', 'SP剩余', 'spRemain'],
        '红尘点': ['剩余DP', 'DP剩余', 'dpRemain'],
        '是否显示_脚本': ['是否显示'],
        '武魂品级': ['武魂品质'],
        '武魂品质': ['武魂品级'],
    };

    function columnCandidates(name) {
        return [name, ...(COLUMN_ALIASES[name] || [])];
    }

    function cell(row, ...names) {
        for (const name of names) {
            for (const candidate of columnCandidates(name)) {
                if (row && row[candidate] !== undefined && row[candidate] !== null && row[candidate] !== '') return row[candidate];
            }
        }
        return '';
    }

    function qualityInfo(value) {
        const text = asText(value);
        for (const item of QUALITY) {
            if (text.includes(item.key)) return item;
        }
        return QUALITY[QUALITY.length - 1];
    }

    function compositeMultiplier(totalInnate, hasSuperGod) {
        const v = Math.max(0, Math.floor(Number(totalInnate) || 0));
        if (v >= 30) return hasSuperGod ? 5.0 : 4.5;
        if (v >= 25) return 4.0;
        if (v >= 20) return 3.0;
        if (v >= 15) return 2.5;
        if (v >= 10) return 2.0;
        if (v >= 7) return 1.6;
        if (v >= 5) return 1.3;
        if (v >= 3) return 1.1;
        return 1.0;
    }

    function parseLevel(statsRow, playerRow) {
        const text = asText(cell(statsRow, '魂力等级')) || asText(cell(playerRow, '魂力等级'));
        const n = num(text, NaN);
        if (Number.isFinite(n)) return Math.max(1, Math.floor(n));
        return 1;
    }

    function cappedGrowthLevel(level) {
        return Math.max(1, Math.min(200, Math.floor(Number(level) || 1)));
    }

    function pointGrowthForLevel(level) {
        const lv = cappedGrowthLevel(level);
        return {
            level: lv,
            sp: Math.max(0, Math.min(lv, 100) - 1) + Math.max(0, lv - 100) * 2,
            dp: Math.floor(lv / 5),
        };
    }

    function parsePointLedger(note) {
        const match = asText(note).match(/点数成长=等级(\d+);SP累计(\d+);DP累计(\d+)/);
        return match
            ? { level: Number(match[1]) || 1, sp: Number(match[2]) || 0, dp: Number(match[3]) || 0 }
            : { level: 1, sp: 0, dp: 0 };
    }

    function readPointRemain(statsRow) {
        const spText = cell(statsRow, '特性点', '剩余SP', 'SP剩余', 'spRemain');
        const dpText = cell(statsRow, '红尘点', '剩余DP', 'DP剩余', 'dpRemain');
        return {
            sp: num(spText, CONFIG.defaults.baseSp),
            dp: num(dpText, CONFIG.defaults.baseDp),
        };
    }

    function pointGrowthState(statsRow, playerRow) {
        const level = parseLevel(statsRow, playerRow);
        const remain = readPointRemain(statsRow);
        const earned = pointGrowthForLevel(level);
        const ledger = parsePointLedger(cell(statsRow, '计算备注'));
        const applied = {
            level: Math.max(ledger.level, earned.level),
            sp: Math.max(ledger.sp, earned.sp),
            dp: Math.max(ledger.dp, earned.dp),
        };
        const delta = {
            sp: Math.max(0, earned.sp - ledger.sp),
            dp: Math.max(0, earned.dp - ledger.dp),
        };
        const after = {
            sp: remain.sp + delta.sp,
            dp: remain.dp + delta.dp,
        };

        return {
            level,
            remain,
            earned,
            applied,
            delta,
            after,
            note: `点数成长=等级${applied.level};SP累计${applied.sp};DP累计${applied.dp};本次+SP${delta.sp}/DP${delta.dp}`,
        };
    }

    async function getPointState() {
        api = getDatabaseApi() || api || await waitForDatabaseApi();
        if (!api) return null;
        const db = api.exportTableAsJson();
        const statsRow = firstRow(db, CONFIG.tables.stats);
        const playerRow = firstRow(db, CONFIG.tables.player);
        return pointGrowthState(statsRow, playerRow);
    }

    function soulRealm(level) {
        const lv = Math.max(1, Math.floor(Number(level) || 1));
        if (lv >= 100) return '神级';
        if (lv >= 99) return '极限斗罗';
        if (lv >= 95) return '超级斗罗';
        if (lv >= 91) return '封号斗罗';
        if (lv >= 81) return '魂斗罗';
        if (lv >= 71) return '魂圣';
        if (lv >= 61) return '魂帝';
        if (lv >= 51) return '魂王';
        if (lv >= 41) return '魂宗';
        if (lv >= 31) return '魂尊';
        if (lv >= 21) return '大魂师';
        if (lv >= 11) return '魂师';
        return '魂士';
    }

    function spiritRealm(points) {
        const v = Number(points) || 0;
        if (v >= 50000) return '神元境';
        if (v >= 20000) return '灵域境';
        if (v >= 5000) return '灵渊境';
        if (v >= 500) return '灵海境';
        if (v >= 51) return '灵通境';
        return '灵元境';
    }

    function battleScale(body, soul, mind) {
        const max = Math.max(Number(body) || 0, Number(soul) || 0, Number(mind) || 0);
        if (max >= 10000) return '神级 / 百万年概念体 / 法则级';
        if (max >= 5000) return '极限斗罗 / 半神，凡界顶点';
        if (max >= 1000) return '魂斗罗 - 弱封号，战略级';
        if (max >= 300) return '魂圣，武魂真身，人形凶兽';
        if (max >= 50) return '魂尊 / 魂宗，小规模战场核心';
        if (max >= 10) return '初级魂师及格线，初步超凡';
        return '普通人水平';
    }

    function parseYear(value, color = '') {
        const text = asText(value);
        if (/百万/.test(text)) {
            const n = num(text, 1);
            return Math.max(1, n) * 1000000;
        }
        const wan = text.match(/(\d+(?:\.\d+)?)\s*万/);
        if (wan) return Number(wan[1]) * 10000;
        const n = num(text, NaN);
        if (Number.isFinite(n)) return n;
        const c = asText(color);
        if (/金|百万/.test(c)) return 1000000;
        if (/红|十万/.test(c)) return 100000;
        if (/黑|万/.test(c)) return 10000;
        if (/紫|千/.test(c)) return 1000;
        if (/黄|百/.test(c)) return 100;
        if (/白|十年/.test(c)) return 10;
        return 0;
    }

    function ringBaseValue(year, color = '') {
        const y = Number(year) || 0;
        if (y >= 1000000 || /金|百万/.test(asText(color))) return 350;
        if (y >= 100000) return 150 + Math.floor((y - 100000) / 100000) * 10;
        if (y >= 10000) return 50 + Math.floor((y - 10000) / 10000) * 5;
        if (y >= 1000) return 20 + Math.floor((y - 1000) / 1000) * 2;
        if (y >= 100) return 5 + Math.floor((y - 100) / 100) * 0.5;
        if (y >= 10) return 1 + Math.floor(y / 10) * 0.1;
        const c = asText(color);
        if (/红|十万/.test(c)) return 150;
        if (/黑|万/.test(c)) return 50;
        if (/紫|千/.test(c)) return 20;
        if (/黄|百/.test(c)) return 5;
        if (/白|十年/.test(c)) return 1;
        return 0;
    }

    function ringTypeScale(type) {
        const text = asText(type);
        const found = RING_TYPE_SCALE.find(item => item.test.test(text));
        return found || { body: 0.5, soul: 0.5, mind: 0.5, name: '均衡型' };
    }

    function parseTriBonus(text) {
        const out = bonus();
        const raw = asText(text);
        if (!raw) return out;

        if (/全属性|三维|全部属性/.test(raw)) {
            const n = num(raw, 0);
            out.body += n;
            out.soul += n;
            out.mind += n;
        }

        const pairs = raw.split(/[;；,\n，]/).map(s => s.trim()).filter(Boolean);
        for (const pair of pairs) {
            const value = num(pair, NaN);
            if (!Number.isFinite(value)) continue;
            if (/肉体|肉身|体魄|力量|气血|防御/.test(pair)) out.body += value;
            else if (/魂力|蓝|能量|法力/.test(pair)) out.soul += value;
            else if (/精神|灵魂|神识|意志/.test(pair)) out.mind += value;
        }
        return out;
    }

    function parseResourceBonus(text) {
        const out = resBonus();
        const raw = asText(text);
        if (!raw) return out;
        const pairs = raw.split(/[;；,\n，]/).map(s => s.trim()).filter(Boolean);
        for (const pair of pairs) {
            const value = num(pair, NaN);
            if (!Number.isFinite(value)) continue;
            if (/血|生命|HP/i.test(pair)) out.hp += value;
            else if (/蓝|魂力|MP|法力|能量/i.test(pair)) out.mp += value;
            else if (/精神力|精神上限|灵魂/i.test(pair)) out.spirit += value;
        }
        return out;
    }

    function formatTri(value) {
        return `肉体:${round(value.body)};魂力:${round(value.soul)};精神:${round(value.mind)}`;
    }

    function traitName(row) {
        return asText(cell(row, '特性名称', '来源特性名称'));
    }

    function collectTraits(db) {
        const stateRows = rows(db, CONFIG.tables.traitState);
        const names = new Set();
        if (stateRows.length) {
            for (const row of stateRows) {
                const name = traitName(row);
                if (name && !no(cell(row, '是否启用'))) names.add(name);
            }
        } else {
            for (const row of rows(db, CONFIG.tables.traits)) {
                const name = traitName(row);
                if (name) names.add(name);
            }
        }
        return names;
    }

    function hasTrait(traits, pattern) {
        for (const name of traits) {
            if (pattern.test(name)) return true;
        }
        return false;
    }

    function traitMatchesSource(traits, source) {
        const text = asText(source);
        if (!text) return true;
        return Array.from(traits).some(name => name.includes(text) || text.includes(name));
    }

    function attrKey(value) {
        const text = asText(value);
        if (/肉体|肉身|体魄|力量|body/i.test(text)) return 'body';
        if (/魂力|蓝|能量|法力|soul/i.test(text)) return 'soul';
        if (/精神|灵魂|神识|意志|mind|spirit/i.test(text)) return 'mind';
        return '';
    }

    function collectTraitAttributeRules(db, traits) {
        const rules = [];
        for (const row of rows(db, CONFIG.tables.traitAttributeRules)) {
            if (no(cell(row, '是否启用'))) continue;
            if (!traitMatchesSource(traits, cell(row, '来源特性名称'))) continue;
            rules.push({
                sourceTrait: traitName(row),
                type: asText(cell(row, '规则类型')),
                stage: asText(cell(row, '作用阶段')),
                source: attrKey(cell(row, '来源属性')),
                target: attrKey(cell(row, '目标属性')),
                formula: asText(cell(row, '结算公式/参数')),
                cap: asText(cell(row, '上限/下限')),
                priority: num(cell(row, '优先级'), 100),
            });
        }
        return rules.sort((a, b) => a.priority - b.priority);
    }

    function builtinConversionRules(traits) {
        const rules = [];
        if (hasTrait(traits, /天与魂缚|天与咒缚|荒古圣体/)) {
            rules.push({ sourceTrait: '内置:魂力转肉体', type: '属性转换', source: 'soul', target: 'body', stage: 'all', priority: 1000 });
        }
        if (hasTrait(traits, /体修无上|数值怪|力道.*宗师/)) {
            rules.push({ sourceTrait: '内置:精神转肉体', type: '属性转换', source: 'mind', target: 'body', stage: 'all', priority: 1001 });
        }
        if (hasTrait(traits, /魂魄之躯|魂魄替代/)) {
            rules.push({ sourceTrait: '内置:肉体转精神', type: '属性转换', source: 'body', target: 'mind', stage: 'all', priority: 1002 });
        }
        return rules;
    }

    function ruleAppliesToStage(rule, stage) {
        const text = asText(rule.stage || 'all');
        if (!text || /all|全部|任意/.test(text)) return true;
        if (/onBeforeStatRecalc|onAfterStatRecalc|重算|自动计算/.test(text)) return true;
        if (stage === 'base') return /基础|base|等级|突破/.test(text);
        if (stage === 'martial') return /武魂|魂环|魂骨|martial/.test(text);
        if (stage === 'other') return /其余|装备|other/.test(text);
        if (stage === 'final') return /最终|final|乘区/.test(text);
        if (stage === 'resource') return /资源|血|蓝|精神力|resource|hp|mp/.test(text);
        if (stage === 'daily') return /日常|六维|daily|检定/.test(text);
        return text.includes(stage);
    }

    function applyConversionToTri(tri, traits, attrRules = [], diagnostics = [], stage = 'all') {
        const out = { ...tri };
        const conversionRules = [...attrRules, ...builtinConversionRules(traits)];
        for (const rule of conversionRules) {
            if (!ruleAppliesToStage(rule, stage)) continue;
            const type = asText(rule.type);
            const from = rule.source;
            const to = rule.target;
            if (!from || !to) continue;
            if (/转换|convert/i.test(type)) {
                out[to] += out[from];
                out[from] = 0;
                diagnostics.push(`${rule.sourceTrait || '属性规则'}:${from}->${to}`);
            } else if (/替代|replace/i.test(type)) {
                out[to] = out[from];
                diagnostics.push(`${rule.sourceTrait || '属性规则'}:${to}=replace(${from})`);
            } else if (/锁定|上限/.test(type) && Number.isFinite(num(rule.cap, NaN))) {
                out[from] = Math.min(out[from], num(rule.cap, out[from]));
                diagnostics.push(`${rule.sourceTrait || '属性规则'}:${from} cap ${rule.cap}`);
            }
        }
        return out;
    }

    const PATH_ALIASES = {
        '肉体': 'final.body',
        '魂力': 'final.soul',
        '精神': 'final.mind',
        '基础肉体': 'base.body',
        '基础魂力': 'base.soul',
        '基础精神': 'base.mind',
        '武魂肉体': 'martial.body',
        '武魂魂力': 'martial.soul',
        '武魂精神': 'martial.mind',
        '最终肉体': 'final.body',
        '最终魂力': 'final.soul',
        '最终精神': 'final.mind',
        '血量上限': 'resource.hpMax',
        '蓝量上限': 'resource.mpMax',
        '精神力上限': 'resource.spiritMax',
    };

    function normalizePath(path, defaultScope = 'final') {
        const raw = asText(path).replace(/[：:]/g, '.');
        if (PATH_ALIASES[raw]) return PATH_ALIASES[raw];
        const mapped = raw
            .replace(/肉体/g, 'body')
            .replace(/魂力/g, 'soul')
            .replace(/精神力/g, 'spiritMax')
            .replace(/精神/g, 'mind')
            .replace(/血量上限/g, 'hpMax')
            .replace(/蓝量上限/g, 'mpMax');
        if (/^(base|martial|other|final|resource|daily|flags)\./.test(mapped)) return mapped;
        if (/^(body|soul|mind)$/.test(mapped)) return `${defaultScope}.${mapped}`;
        return mapped;
    }

    function pathGet(ctx, path) {
        const parts = normalizePath(path).split('.');
        let cur = ctx;
        for (const part of parts) {
            if (!cur || cur[part] === undefined) return undefined;
            cur = cur[part];
        }
        return cur;
    }

    function pathSet(ctx, path, value) {
        const parts = normalizePath(path).split('.');
        let cur = ctx;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i];
            if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
            cur = cur[part];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function executeDslStatement(ctx, statement, diagnostics = [], source = 'DSL') {
        const text = asText(statement);
        if (!text) return;
        let match = text.match(/^(.+?)\s*(\+=|-=|\*=|=)\s*(-?\d+(?:\.\d+)?)$/);
        if (match) {
            const path = normalizePath(match[1]);
            const op = match[2];
            const value = Number(match[3]);
            const current = Number(pathGet(ctx, path)) || 0;
            if (op === '+=') pathSet(ctx, path, current + value);
            else if (op === '-=') pathSet(ctx, path, current - value);
            else if (op === '*=') pathSet(ctx, path, current * value);
            else pathSet(ctx, path, value);
            diagnostics.push(`${source}:${path}${op}${value}`);
            return;
        }
        match = text.match(/^(capMin|capMax)\((.+?),\s*(-?\d+(?:\.\d+)?)\)$/i);
        if (match) {
            const fn = match[1], path = normalizePath(match[2]), value = Number(match[3]), current = Number(pathGet(ctx, path)) || 0;
            pathSet(ctx, path, fn.toLowerCase() === 'capmin' ? Math.max(current, value) : Math.min(current, value));
            diagnostics.push(`${source}:${fn}(${path},${value})`);
            return;
        }
        match = text.match(/^(convertTo|replaceWith)\((.+?),\s*(.+?)\)$/i) || text.match(/^(.+?)\s+(convertTo|replaceWith)\s+(.+)$/i);
        if (match) {
            const fn = /^convert|^replace/i.test(match[1]) ? match[1] : match[2];
            const from = normalizePath(/^convert|^replace/i.test(match[1]) ? match[2] : match[1]);
            const to = normalizePath(/^convert|^replace/i.test(match[1]) ? match[3] : match[3]);
            const value = Number(pathGet(ctx, from)) || 0;
            if (/convert/i.test(fn)) {
                pathSet(ctx, to, (Number(pathGet(ctx, to)) || 0) + value);
                pathSet(ctx, from, 0);
            } else {
                pathSet(ctx, to, value);
            }
            diagnostics.push(`${source}:${fn}(${from}->${to})`);
            return;
        }
        match = text.match(/^(disable|immune)\((.+?)\)$/i);
        if (match) {
            const bucket = match[1].toLowerCase() === 'disable' ? 'disabled' : 'immune';
            if (!ctx.flags[bucket]) ctx.flags[bucket] = [];
            ctx.flags[bucket].push(match[2].trim());
            diagnostics.push(`${source}:${bucket}(${match[2].trim()})`);
            return;
        }
        diagnostics.push(`${source}:无法解析 ${text}`);
    }

    function executeDsl(ctx, scriptText, diagnostics = [], source = 'DSL') {
        asText(scriptText).split(/[;；\n]/).map(s => s.trim()).filter(Boolean)
            .forEach(statement => executeDslStatement(ctx, statement, diagnostics, source));
    }

    function formulaToDsl(formula, stageText) {
        const raw = asText(formula);
        if (!raw) return '';
        if (/[.=()]|\+=|-=|\*=|convertTo|replaceWith|capMin|capMax|disable|immune/i.test(raw)) return raw;
        const multiplier = raw.match(/(?:x|×)?\s*(\d+(?:\.\d+)?)\s*倍?/i);
        const add = raw.match(/([+-]\d+(?:\.\d+)?)/);
        const op = multiplier ? `*=${multiplier[1]}` : (add ? `+=${add[1]}` : '');
        if (!op) return raw;
        const stage = asText(stageText);
        const targets = [];
        if (/肉体|肉身|body/.test(stage)) targets.push('final.body');
        if (/魂力|soul/.test(stage)) targets.push('final.soul');
        if (/精神(?!力)|mind/.test(stage)) targets.push('final.mind');
        if (/全属性|三维|最终|乘区|领域|真身/.test(stage) || !targets.length) targets.push('final.body', 'final.soul', 'final.mind');
        return Array.from(new Set(targets)).map(path => `${path} ${op}`).join(';');
    }

    function collectDslRules(db, traits) {
        const out = [];
        for (const tableName of [CONFIG.tables.traitRules, CONFIG.tables.traitTempStates]) {
            for (const row of rows(db, tableName)) {
                if (no(cell(row, '是否启用', '是否脚本自动执行'))) continue;
                if (!traitMatchesSource(traits, cell(row, '来源特性名称'))) continue;
                const formula = cell(row, '结算参数', '修正公式/数值');
                if (!asText(formula)) continue;
                const stage = asText(cell(row, '作用阶段', '触发时机', '乘区类型'));
                out.push({
                    source: `${tableName}:${traitName(row) || cell(row, '状态名称') || '规则'}`,
                    stage,
                    formula: formulaToDsl(formula, stage),
                    priority: num(cell(row, '优先级'), 100),
                    layers: Math.max(1, num(cell(row, '当前层数/次数'), 1)),
                });
            }
        }
        return out.sort((a, b) => a.priority - b.priority);
    }

    function applyDslRules(ctx, rules, stage, diagnostics) {
        for (const rule of rules) {
            if (!ruleAppliesToStage(rule, stage) && !/final|最终|乘区|状态/.test(asText(rule.stage))) continue;
            for (let i = 0; i < rule.layers; i += 1) executeDsl(ctx, rule.formula, diagnostics, rule.source);
        }
    }

    function activeText(db) {
        const stats = firstRow(db, CONFIG.tables.stats);
        const pieces = [
            cell(stats, '武魂真身状态'),
            cell(stats, '其他Buff'),
        ];
        for (const row of rows(db, CONFIG.tables.traitTempStates)) {
            if (!no(cell(row, '是否启用'))) {
                pieces.push(cell(row, '状态名称'), cell(row, '触发条件'), cell(row, '乘区类型'), cell(row, '修正公式/数值'));
            }
        }
        return pieces.map(asText).filter(Boolean).join(';');
    }

    function resonance(row) {
        const direct = num(cell(row, '共鸣率_脚本', '本体阶位'), NaN);
        if (Number.isFinite(direct) && direct > 0) {
            return direct > 3 ? direct / 100 : direct;
        }
        const text = asText(cell(row, '本体阶位'));
        if (/圆满|极致|完全|100/.test(text)) return 1;
        if (/高阶|80/.test(text)) return 0.8;
        if (/中阶|60/.test(text)) return 0.6;
        if (/初阶|40/.test(text)) return 0.4;
        if (/未/.test(text)) return 0.2;
        return yes(cell(row, '是否本体武魂')) ? 1 : 1;
    }

    function martialContext(db, traits) {
        const overviewRows = rows(db, CONFIG.tables.soulOverview);
        const infos = overviewRows.map(row => {
            const q = qualityInfo(cell(row, '武魂品级'));
            const awakened = !no(cell(row, '觉醒状态')) && !/未觉醒/.test(asText(cell(row, '觉醒状态')));
            return {
                row,
                name: asText(cell(row, '武魂名称')),
                seq: num(cell(row, '序号'), 0),
                quality: q,
                awakened,
                isExtreme: /极致/.test(asText(cell(row, '特殊属性'))) || yes(cell(row, '是否极致_脚本')),
                isBody: yes(cell(row, '是否本体武魂')),
                resonance: resonance(row),
            };
        });
        const active = infos.filter(info => info.awakened);
        const first = active[0]?.quality.level || 0;
        let totalInnate = 0;
        if (active.length === 1) totalInnate = first;
        else if (active.length >= 2) {
            totalInnate = Math.max(first, 10) + active.slice(1).reduce((sum, info) => sum + info.quality.level, 0);
        }
        totalInnate = Math.min(30, totalInnate);
        const hasSuperGod = active.some(info => info.quality.key === '超神级');
        const byTotal = compositeMultiplier(totalInnate, hasSuperGod);
        const sortedMultipliers = active.map(info => info.quality.multiplier).sort((a, b) => b - a);
        const hasLink = hasTrait(traits, /武魂串联|焚诀/);
        const multiplier = hasLink
            ? round(sortedMultipliers.slice(0, 2).reduce((sum, value) => sum + value, 0) || byTotal)
            : round(sortedMultipliers[0] || byTotal || 1);
        const bodySoul = active.find(info => info.isBody);
        const maxResonance = active.reduce((max, info) => Math.max(max, info.isBody ? info.resonance : 1), 1);
        return {
            rows: infos,
            active,
            totalInnate,
            byTotal,
            multiplier,
            hasLink,
            hasBodySoul: Boolean(bodySoul),
            resonance: maxResonance,
            source: hasLink ? '武魂串联/并联：取最高两个已觉醒武魂倍率求和' : '默认：取已觉醒武魂最高倍率',
        };
    }

    function calcRingBonus(row, traits, attrRules = [], diagnostics = []) {
        const year = parseYear(cell(row, '魂环年限'), cell(row, '魂环颜色'));
        const base = ringBaseValue(year, cell(row, '魂环颜色'));
        const scale = ringTypeScale(cell(row, '魂环类型'));
        let out = bonus(base * scale.body, base * scale.soul, base * scale.mind);
        const notes = [`${scale.name};基础值=${round(base)}`];

        const sourceText = [
            cell(row, '魂兽来源'),
            cell(row, '魂环类型'),
            cell(row, '详细效果'),
        ].join(';');
        const isDragon = /龙|dragon/i.test(sourceText);
        if (isDragon && hasTrait(traits, /龙心/)) {
            out = bonus(out.body * 2, out.soul * 2, out.mind * 2);
            notes.push('龙心:龙类来源三维增益x2');
        }
        if (isDragon && hasTrait(traits, /屠龙者/)) {
            out.body *= 2;
            notes.push('屠龙者:龙类魂环肉体增益x2');
        }

        const ringIndex = num(cell(row, '魂环序号'), 0);
        if (ringIndex === 1 && hasTrait(traits, /超绝吟唱|终极吟唱/)) {
            out = bonus(out.body * 2, out.soul * 2, out.mind * 2);
            notes.push('超绝吟唱:第一魂环属性x2');
        }

        out = applyConversionToTri(out, traits, attrRules, diagnostics, 'martial');
        return {
            year,
            base,
            tri: out,
            note: notes.join(';'),
        };
    }

    function collectEquipment(db) {
        const martial = bonus();
        const other = bonus();
        const resources = resBonus();
        const details = [];

        function addRows(tableName, options) {
            for (const row of rows(db, tableName)) {
                if (options.requireDisplay && no(cell(row, '是否显示_脚本'))) continue;
                const enabledFlag = cell(row, '是否装备', '是否启用', '状态');
                const enabled = options.enabledDefault ? !no(enabledFlag) : yes(enabledFlag);
                if (!enabled) continue;

                const tri = parseTriBonus([
                    cell(row, '三维加成'),
                    cell(row, '特殊能力'),
                    cell(row, '效果描述'),
                    cell(row, '备注'),
                ].filter(Boolean).join(';'));
                const res = parseResourceBonus([
                    cell(row, '资源加成'),
                    cell(row, '特殊能力'),
                    cell(row, '效果描述'),
                    cell(row, '备注'),
                ].filter(Boolean).join(';'));
                const joinMartial = yes(cell(row, '是否参与武魂相关计算')) || yes(cell(row, '是否参与倍率计算'));
                if (joinMartial) addTri(martial, tri);
                else addTri(other, tri);
                addRes(resources, res);
                details.push(`${options.label}:${asText(cell(row, options.nameCol)) || '未命名'}=>${joinMartial ? '武魂相关' : '其余加成'}`);
            }
        }

        addRows(CONFIG.tables.soulBones, { label: '魂骨/魂核', nameCol: '当前物品名称' });
        addRows(CONFIG.tables.spirits, { label: '魂灵', nameCol: '魂灵名称', enabledDefault: true });
        addRows(CONFIG.tables.armor, { label: '斗铠', nameCol: '斗铠部位/名称', requireDisplay: true });
        addRows(CONFIG.tables.soulDevices, { label: '魂导器', nameCol: '魂导器名称' });
        addRows(CONFIG.tables.skills, { label: '通用技能', nameCol: '技能名称', enabledDefault: true });

        return { martial, other, resources, details };
    }

    function collectDailyBonuses(db) {
        const daily = { 悟性: 0, 气场: 0, 百工: 0, 气运: 0, 学识: 0, 阅历: 0 };
        const details = [];
        function addDaily(text, source) {
            const raw = asText(text);
            if (!raw) return;
            for (const key of Object.keys(daily)) {
                const match = raw.match(new RegExp(`${key}\\s*[:：+＋]?\\s*(-?\\d+)`));
                if (match) {
                    daily[key] += Number(match[1]) || 0;
                    details.push(`${source}:${key}${match[1]}`);
                }
            }
        }
        for (const row of rows(db, CONFIG.tables.titlePanel)) {
            if (no(cell(row, '是否启用'))) continue;
            addDaily(cell(row, '六维调整值'), cell(row, '当前称号名称') || '称号');
        }
        return { daily, details };
    }

    function refreshTraitEquipmentSlots(db, traits) {
        const updates = [];
        const slotRows = rows(db, CONFIG.tables.traitEquipmentSlots);
        const visibleBySlot = new Map();

        for (const row of slotRows) {
            const trait = traitName(row);
            const active = trait && Array.from(traits).some(name => name.includes(trait) || trait.includes(name));
            const display = active ? '是' : '否';
            const enabled = active ? '是' : '否';
            visibleBySlot.set(asText(cell(row, '槽位ID')), display);
            if (asText(cell(row, '是否显示_脚本')) !== display || asText(cell(row, '是否启用')) !== enabled) {
                updates.push({
                    table: CONFIG.tables.traitEquipmentSlots,
                    rowIndex: row.__rowIndex,
                    data: { '是否显示_脚本': display, '是否启用': enabled },
                });
            }
        }

        for (const tableName of [CONFIG.tables.armor, CONFIG.tables.soulDevices, CONFIG.tables.soulBones]) {
        for (const row of rows(db, tableName)) {
            const slotId = asText(cell(row, '槽位ID', '槽位编号', '部位'));
            const condition = asText(cell(row, '显示条件'));
            let display = '是';
            if (visibleBySlot.has(slotId)) display = visibleBySlot.get(slotId);
            else if (/需要特性/.test(condition)) display = '否';
            if (row['是否显示_脚本'] === undefined && row['是否显示'] === undefined) continue;
            if (asText(cell(row, '是否显示_脚本')) !== display) {
                updates.push({
                    table: tableName,
                    rowIndex: row.__rowIndex,
                    data: { '是否显示_脚本': display },
                });
            }
        }
        }

        return updates;
    }

    function calcFinals(baseInput, martialRawInput, otherInput, ctx, traits, stateText, ruleState = {}) {
        const diagnostics = ruleState.diagnostics || [];
        let base = applyConversionToTri(baseInput, traits, ruleState.attrRules || [], diagnostics, 'base');
        let martialRaw = applyConversionToTri(martialRawInput, traits, ruleState.attrRules || [], diagnostics, 'martial');
        let other = applyConversionToTri(otherInput, traits, ruleState.attrRules || [], diagnostics, 'other');

        let multiplier = ctx.multiplier || 1;
        if (hasTrait(traits, /魂力心脏|柱间细胞/)) multiplier += 0.8;

        if (/永劫燔世|先天领域|领域开启/.test(stateText)) {
            multiplier += 0.8;
        }

        const avatar = /已开启|开启|真身|完全燃烧/.test(stateText);
        const resonanceRate = ctx.hasBodySoul ? (ctx.resonance || 1) : 1;

        const final = bonus();
        const martialScript = bonus();
        for (const key of ['body', 'soul', 'mind']) {
            let value;
            if (ctx.hasBodySoul) {
                value = avatar
                    ? (base[key] + martialRaw[key]) * multiplier * resonanceRate + other[key]
                    : (base[key] * resonanceRate + martialRaw[key]) * multiplier + other[key];
            } else if (avatar) {
                value = (base[key] + martialRaw[key]) * multiplier + other[key];
            } else {
                value = base[key] + martialRaw[key] * multiplier + other[key];
            }
            final[key] = round(value);
            martialScript[key] = round(value - base[key] - other[key]);
        }

        if (hasTrait(traits, /真祖/)) {
            if (/夜晚|黑夜|夜间/.test(stateText)) {
                final.body *= 2; final.soul *= 2; final.mind *= 2;
            } else if (/白天|日间|正午/.test(stateText)) {
                final.body *= 0.5; final.soul *= 0.5; final.mind *= 0.5;
            }
        }
        if (hasTrait(traits, /太阳之子/)) {
            if (/白天|日间|正午|强光/.test(stateText)) {
                final.body *= 2; final.soul *= 2; final.mind *= 2;
            } else if (/夜晚|黑夜|夜间/.test(stateText)) {
                final.body *= 0.5; final.soul *= 0.5; final.mind *= 0.5;
            }
        }

        const dslContext = {
            base,
            martial: martialRaw,
            other,
            final,
            resource: {},
            daily: ruleState.daily || {},
            flags: ruleState.flags || {},
        };
        applyDslRules(dslContext, ruleState.dslRules || [], 'final', diagnostics);
        base = dslContext.base;
        martialRaw = dslContext.martial;
        other = dslContext.other;
        final.body = dslContext.final.body;
        final.soul = dslContext.final.soul;
        final.mind = dslContext.final.mind;

        final.body = round(final.body);
        final.soul = round(final.soul);
        final.mind = round(final.mind);
        return { base, martialRaw, other, martialScript, final, multiplier: round(multiplier), avatar, resonanceRate, flags: dslContext.flags, daily: dslContext.daily };
    }

    function resourceMax(level, final, resourceBonus, traits, stateText, ruleState = {}) {
        let hpStat = final.body;
        let mpStat = final.soul;
        if (hasTrait(traits, /魂魄之躯/)) hpStat = final.mind;
        if (hasTrait(traits, /魔人之躯/)) hpStat = Math.floor((final.body + final.soul) * 0.75);
        if (hasTrait(traits, /九戒体质/)) mpStat = Math.floor((final.soul + final.mind) * 0.75);

        let hp = final.body * 5 * CONFIG.defaults.lifeCoef + level * 100;
        hp = hp - final.body * 5 * CONFIG.defaults.lifeCoef + hpStat * 5 * CONFIG.defaults.lifeCoef;
        let mp = level * CONFIG.defaults.mpGrowth + mpStat;
        let spirit = (level * CONFIG.defaults.spiritGrowth + final.mind) * 5;

        if (hasTrait(traits, /点燃星海|流萤/)) hp *= 0.5;
        if (hasTrait(traits, /魂力心脏|柱间细胞/)) mp *= 3;
        if (/永劫燔世|先天领域|领域开启/.test(stateText)) hp *= 3;

        hp += resourceBonus.hp;
        mp += resourceBonus.mp;
        spirit += resourceBonus.spirit;

        const dslContext = {
            base: {},
            martial: {},
            other: {},
            final,
            resource: { hpMax: hp, mpMax: mp, spiritMax: spirit },
            daily: ruleState.daily || {},
            flags: ruleState.flags || {},
        };
        applyDslRules(dslContext, ruleState.dslRules || [], 'resource', ruleState.diagnostics || []);
        hp = dslContext.resource.hpMax;
        mp = dslContext.resource.mpMax;
        spirit = dslContext.resource.spiritMax;

        return {
            hp: Math.max(1, Math.floor(hp)),
            mp: Math.max(0, Math.floor(mp)),
            spirit: Math.max(0, Math.floor(spirit)),
        };
    }

    function clampCurrentValue(current, max, label, diagnostics) {
        if (empty(current)) return { value: String(max), changed: true, reason: `${label}为空，写入上限` };
        const n = num(current, NaN);
        if (!Number.isFinite(n)) return { value: current, changed: false, reason: '' };
        if (n > max) {
            diagnostics.push(`${label}当前值${n}超过上限${max}，已钳制`);
            return { value: String(max), changed: true, reason: `${label}钳制${n}->${max}` };
        }
        return { value: current, changed: false, reason: '' };
    }

    async function updateRows(updates, options = {}) {
        const failed = [];
        for (const update of updates) {
            if (!update || !update.table || !update.rowIndex || !update.data) continue;
            const result = await updateRowCompat(update.table, update.rowIndex, update.data, options);
            if (apiWriteFailed(result)) failed.push(`${update.table}:updateRow failed`);
        }
        return failed;
    }

    async function upsertFirstRow(tableName, existingRow, data, options = {}) {
        if (existingRow && existingRow.__rowIndex) {
            return updateRowCompat(tableName, existingRow.__rowIndex, data, options);
        }
        if (typeof api.insertRow === 'function') {
            return insertRowCompat(tableName, { row_id: 1, ...data }, options);
        }
        return false;
    }

    function ageLabel(value) {
        const map = { none: '未选择年限', 10: '十年', 100: '百年', 1000: '千年', 10000: '万年', 100000: '十万年', 1000000: '百万年' };
        return map[String(value)] || asText(value) || '未选择年限';
    }

    function noteText(note, key) {
        return note && typeof note === 'object' ? asText(note[key]) : '';
    }

    function rowIsBlank(row) {
        return row && Object.keys(row).filter(k => !k.startsWith('__')).every(k => !asText(row[k]));
    }

    function resolveMappingRow(db, tableName, options = {}) {
        const list = rows(db, tableName);
        const matched = options.match ? list.find(options.match) : null;
        if (matched) return { rowIndex: matched.__rowIndex, mode: 'update' };
        const blank = list.find(rowIsBlank);
        if (blank) return { rowIndex: blank.__rowIndex, mode: 'update' };
        if (options.fallbackIndex && list[options.fallbackIndex - 1]) return { rowIndex: list[options.fallbackIndex - 1].__rowIndex, mode: 'update' };
        return { rowIndex: null, mode: 'insert' };
    }

    function addMappingOp(db, ops, tableName, data, options = {}) {
        const target = resolveMappingRow(db, tableName, options);
        ops.push({ table: tableName, rowIndex: target.rowIndex, mode: target.mode, data });
    }

    function payloadSoulName(soul, index) {
        return asText(soul?.name) || ['第一武魂', '第二武魂', '第三武魂'][index] || `第${index + 1}武魂`;
    }

    function payloadSoulQualityName(soul) {
        return asText(soul?.qualityName || soul?.quality?.name || soul?.qualityLabel || soul?.quality) || '中级';
    }

    function noteSummary(note) {
        if (!note || typeof note !== 'object') return '';
        return Object.entries(note).filter(([, value]) => asText(value)).map(([key, value]) => `${key}:${asText(value)}`).join(';');
    }

    function buildCreationMapping(payload, db = {}) {
        const character = payload?.character || {};
        const pointBuy = payload?.pointBuy || {};
        const profile = payload?.effectiveInnateProfile || {};
        const worldBook = payload?.worldBookProfile || {};
        const ops = [];
        const battle = character.battle || payload?.battle || {};
        const daily = character.daily || payload?.daily || {};
        const dailyLabels = { comprehension: '悟性', presence: '气场', craft: '百工', luck: '气运', knowledge: '学识', experience: '阅历' };
        const dailyText = Object.entries(daily).map(([key, value]) => `${dailyLabels[key] || key}:${value}`).join(';');
        const level = asText(character.level) || asText(profile.level) || '10';
        const name = asText(character.name) || (payload?.species === 'beast' ? '未命名魂兽' : '未命名魂师');

        addMappingOp(db, ops, CONFIG.tables.player, {
            '人物名称': name,
            '性别': asText(character.gender),
            '年龄/阶段': asText(character.age),
            '身份/阵营': [payload?.species === 'beast' ? `魂兽开局/${payload?.beastForm || ''}` : '人类魂师', asText(character.profileRole)].filter(Boolean).join(' / '),
            '外貌特征': [asText(character.profileAppearance), asText(character.outfit), asText(character.concept)].filter(Boolean).join('；'),
            '当前所在主地点': asText(payload?.location),
            '当前子地点': asText(payload?.chapter),
            '魂力等级': level,
            '当前目标': asText(character.startingGoal) || '开局建档完成，等待第一幕推进',
            '状态备注': [asText(character.canonRelation), asText(character.concept)].filter(Boolean).join('；'),
        }, { fallbackIndex: 1 });

        addMappingOp(db, ops, CONFIG.tables.stats, {
            '魂力等级': level,
            '肉体_基础': String(battle.body ?? 1),
            '魂力_基础': String(battle.soulPower ?? battle.soul ?? 1),
            '精神_基础': String(battle.spirit ?? battle.mind ?? 1),
            '日常六维与调整值': dailyText,
            '特性点': String(pointBuy.remain ?? pointBuy.spRemain ?? CONFIG.defaults.baseSp),
            '红尘点': String(pointBuy.dpRemain ?? CONFIG.defaults.baseDp),
            '自动计算锁定': '否',
            '计算备注': `前端建档;SP剩余=${pointBuy.remain ?? pointBuy.spRemain ?? CONFIG.defaults.baseSp};DP剩余=${pointBuy.dpRemain ?? CONFIG.defaults.baseDp}`,
        }, { fallbackIndex: 1 });

        (character.souls || []).slice(0, 3).forEach((soul, index) => {
            const soulName = payloadSoulName(soul, index);
            addMappingOp(db, ops, CONFIG.tables.soulOverview, {
                '序号': String(index + 1),
                '武魂名称': soulName,
                '主导倾向': asText(soul.dominance),
                '武魂品级': payloadSoulQualityName(soul),
                '觉醒状态': soul.unlocked ? '已觉醒' : '未觉醒',
                '是否极致_脚本': soul.isExtreme ? '是' : '否',
                '特殊属性': [...(soul.normalAttributes || []), soul.customAttribute, ...(soul.ruleAttributes || [])].filter(Boolean).join('/'),
                '是否本体武魂': soul.category === '本体武魂' || soul.isBodySoul ? '是' : '否',
                '本体部位': soul.category === '本体武魂' ? asText(soul.bodyPart) : '',
                '简介与描述': [asText(soul.appearance), asText(soul.combatStyle), soul.isExtreme ? `极致属性=${asText(soul.extremeAttribute) || '待定'}` : ''].filter(Boolean).join('；'),
                '武魂来源/形态': asText(soul.category || soul.cat),
                '规则属性': (soul.ruleAttributes || []).join('/'),
                '限制/代价': asText(soul.costOrLimit),
                '计算备注': `前端建档;品质对应等级=${soul.innateSoulPower || soul.qualityMappedLevel || ''};极致属性=${soul.isExtreme ? (asText(soul.extremeAttribute) || '待定') : '否'}`,
            }, { fallbackIndex: index + 1, match: row => Number(cell(row, '序号')) === index + 1 || asText(cell(row, '武魂名称')) === soulName });
        });

        CONFIG.tables.rings.forEach((tableName, soulIndex) => {
            const soul = (character.souls || [])[soulIndex] || {};
            const ringNotes = character.ringNotes || {};
            (character.rings || []).forEach((value, index) => {
                const note = ringNotes[`ring-${index}`] || {};
                if (String(value || 'none') === 'none' && !noteSummary(note)) return;
                addMappingOp(db, ops, tableName, {
                    '武魂名称': payloadSoulName(soul, soulIndex),
                    '魂环序号': String(index + 1),
                    '魂技名称': noteText(note, 'skill1Name') || noteText(note, 'name') || `第${index + 1}魂环`,
                    '魂环年限': ageLabel(value),
                    '魂环颜色': ageLabel(value),
                    '魂环类型': noteText(note, 'source') || '待定',
                    '魂兽来源': noteText(note, 'source'),
                    '来源标签': noteText(note, 'source'),
                    '详细效果': noteSummary(note),
                }, { fallbackIndex: index + 1, match: row => Number(cell(row, '魂环序号')) === index + 1 });
            });
        });

        const spiritNotes = character.spiritNotes || {};
        (character.spirits || []).forEach((value, index) => {
            const note = spiritNotes[`spirit-${index}`] || {};
            if (String(value || 'none') === 'none' && !noteSummary(note)) return;
            const spiritName = noteText(note, 'name') || `魂灵契约${index + 1}`;
            addMappingOp(db, ops, CONFIG.tables.spirits, {
                '魂灵名称': spiritName,
                '年限/等级': ageLabel(value),
                '绑定武魂': payloadSoulName((character.souls || [])[0] || {}, 0),
                '附带魂环/魂技': noteText(note, 'skill1Name') || '待定',
                '特殊能力': noteSummary(note),
                '状态': '已记录',
                '备注': '前端建档写入',
            }, { fallbackIndex: index + 1, match: row => asText(cell(row, '魂灵名称')) === spiritName });
        });

        const traitDetails = character.resources?.traitDetails || [];
        traitDetails.forEach((trait, index) => {
            const traitNameText = asText(trait.name);
            const custom = trait.id === 'custom_specialty';
            addMappingOp(db, ops, CONFIG.tables.traits, {
                '特性名称': traitNameText,
                '花费特性点': `${Number(trait.cost) > 0 ? '+' : ''}${trait.cost || 0} SP`,
                '特性类型': asText(trait.tag) || '特性',
                '结算方式': custom ? '待解析规则' : '被动常驻',
                '触发时机': '建卡/onBeforeStatRecalc',
                '脚本钩子': 'onCharacterCreate;onBeforeStatRecalc',
                '底层规则干涉': asText(trait.desc),
            }, { fallbackIndex: index + 1, match: row => asText(cell(row, '特性名称')) === traitNameText });
            addMappingOp(db, ops, CONFIG.tables.traitState, {
                '特性名称': traitNameText,
                '来源特性行编号': String(index + 1),
                '是否启用': '是',
                '当前阶段/状态': custom ? '待解析规则' : '常驻',
                '触发标记': '建卡写入',
                '脚本钩子': 'onBeforeStatRecalc',
                '状态备注': asText(trait.desc),
            }, { fallbackIndex: index + 1, match: row => asText(cell(row, '特性名称')) === traitNameText });
        });

        addMappingOp(db, ops, CONFIG.tables.notes, {
            '时间跨度': asText(payload?.chapter),
            '地点': asText(payload?.location),
            '纪要类型': '开局建档',
            '纪要': asText(character.concept) || '角色创建前端写入开局档案',
            '概览': `时代=${payload?.era?.name || ''};综合先天魂力=${profile.level || ''}`,
            '关联人物': name,
            '待办/线索': asText(character.bondNote) || '等待第一幕推进',
            '编码索引': 'character-create',
        }, { match: row => asText(cell(row, '编码索引')) === 'character-create' });

        (worldBook.bondCharacterControls || []).forEach((npc, index) => {
            const npcName = asText(npc.name);
            addMappingOp(db, ops, CONFIG.tables.npcs, {
                '姓名': npcName,
                '性别': asText(npc.gender),
                '身份/阵营': asText(npc.groupName || npc.version),
                '当前地点': asText(payload?.location),
                '关系定位': '前端羁绊控制预留',
                '当前状态': asText(npc.version),
                '互动准则': (npc.entries || []).join('/'),
                '关系变化提示': asText(character.bondNote) || '按剧情推进更新',
                '备注': '角色创建前端写入，不推断未填能力',
            }, { fallbackIndex: index + 1, match: row => asText(cell(row, '姓名')) === npcName });
        });

        return { payload, ops, summary: { count: ops.length, tables: Array.from(new Set(ops.map(op => op.table))), spRemain: pointBuy.remain ?? pointBuy.spRemain } };
    }

    function previewCreationMapping(payload, dbOverride = null) {
        const db = dbOverride || (api && typeof api.exportTableAsJson === 'function' ? api.exportTableAsJson() : {});
        return buildCreationMapping(payload, db);
    }

    function apiWriteFailed(result) {
        return result === false
            || result === null
            || result === -1
            || (result && typeof result === 'object' && result.success === false);
    }

    function writeMutationOptions(options = {}) {
        const quiet = options.quiet !== false;
        return {
            skipNotify: options.skipNotify ?? quiet,
            silent: options.silent ?? quiet,
            isImportMode: options.isImportMode ?? quiet,
        };
    }

    async function updateRowCompat(tableName, rowIndex, data, options = {}) {
        if (!api || typeof api.updateRow !== 'function') return false;
        try {
            let result = await api.updateRow({
                tableName,
                rowIndex,
                data,
                ...writeMutationOptions(options),
            });
            if (apiWriteFailed(result) && options.fallbackLegacy !== false) {
                result = await api.updateRow(tableName, rowIndex, data);
            }
            return result;
        } catch (error) {
            if (options.fallbackLegacy === false) throw error;
            console.warn(`[${SCRIPT_NAME}] updateRow object args failed, fallback to legacy args`, error);
            return api.updateRow(tableName, rowIndex, data);
        }
    }

    async function insertRowCompat(tableName, data, options = {}) {
        if (!api || typeof api.insertRow !== 'function') return false;
        try {
            let result = await api.insertRow({
                tableName,
                data,
                ...writeMutationOptions(options),
            });
            if (apiWriteFailed(result) && options.fallbackLegacy !== false) {
                result = await api.insertRow(tableName, data);
            }
            return result;
        } catch (error) {
            if (options.fallbackLegacy === false) throw error;
            console.warn(`[${SCRIPT_NAME}] insertRow object args failed, fallback to legacy args`, error);
            return api.insertRow(tableName, data);
        }
    }

    async function applyCreationPayload(payload, options = {}) {
        api = getDatabaseApi() || api || await waitForDatabaseApi();
        if (!api || typeof api.updateRow !== 'function') return { ok: false, message: 'AutoCardUpdaterAPI.updateRow unavailable' };
        const db = api.exportTableAsJson ? api.exportTableAsJson() : {};
        const mapping = buildCreationMapping(payload, db);
        const readiness = verifyDatabaseReady(db, mapping.summary.tables);
        if (!readiness.ok) {
            console.warn(`[${SCRIPT_NAME}] ${readiness.message}`, readiness.missing);
            return { ok: false, message: readiness.message, missingTables: readiness.missing, mapping };
        }
        const spRemain = Number(mapping.summary.spRemain);
        if (Number.isFinite(spRemain) && spRemain < 0 && !options.force) {
            return { ok: false, message: 'SP 已超支，阻止写入数据库。', mapping };
        }
        const missing = [];
        for (const op of mapping.ops) {
            if (op.rowIndex) {
                const result = await updateRowCompat(op.table, op.rowIndex, op.data, options);
                if (apiWriteFailed(result)) missing.push(`${op.table}:updateRow失败`);
            } else if (typeof api.insertRow === 'function') {
                const result = await insertRowCompat(op.table, op.data, options);
                if (apiWriteFailed(result)) missing.push(`${op.table}:insertRow失败`);
            }
            else missing.push(`${op.table}:缺少可写行`);
        }
        let recalculation = null;
        if (!options.skipRecalculate) {
            recalculation = await recalculate({ force: true });
            if ((recalculation?.skipped || recalculation?.ok === false) && api.refreshDataAndWorldbook) await api.refreshDataAndWorldbook();
        }
        else if (api.refreshDataAndWorldbook) await api.refreshDataAndWorldbook();
        return { ok: missing.length === 0, message: missing.length ? `部分写入完成，跳过${missing.length}项。` : `已写入${mapping.ops.length}项数据库更新。`, missing, mapping };
    }

    function diagnose(dbOverride = null) {
        const db = dbOverride || (api && typeof api.exportTableAsJson === 'function' ? api.exportTableAsJson() : null);
        const issues = [];
        if (!db) return { ok: false, issues: ['无法读取数据库'] };
        const missing = missingTables(db);
        if (missing.length) {
            issues.push(databaseRepairHint(missing));
            missing.forEach(tableName => issues.push(`缺少表：${tableName}`));
        }
        for (const row of rows(db, CONFIG.tables.traitRules)) {
            const formula = cell(row, '结算参数');
            if (asText(formula)) {
                const diagnostics = [];
                executeDsl({ base: bonus(), martial: bonus(), other: bonus(), final: bonus(), resource: {}, daily: {}, flags: {} }, formula, diagnostics, `诊断:${traitName(row) || '规则'}`);
                diagnostics.filter(text => text.includes('无法解析')).forEach(text => issues.push(text));
            }
        }
        for (const row of rows(db, CONFIG.tables.traitTempStates)) {
            const formula = cell(row, '修正公式/数值');
            if (asText(formula) && /[A-Za-z\u4e00-\u9fa5]/.test(asText(formula))) {
                const diagnostics = [];
                executeDsl({ base: bonus(), martial: bonus(), other: bonus(), final: bonus(), resource: {}, daily: {}, flags: {} }, formula, diagnostics, `诊断:${cell(row, '状态名称') || '状态'}`);
                diagnostics.filter(text => text.includes('无法解析')).forEach(text => issues.push(text));
            }
        }
        return { ok: issues.length === 0, issues };
    }

    function combatAttackValue(stats, type) {
        const body = Number(stats.body ?? stats.肉体 ?? stats.finalBody ?? 0) || 0;
        const soul = Number(stats.soul ?? stats.魂力 ?? stats.finalSoul ?? 0) || 0;
        const mind = Number(stats.mind ?? stats.精神 ?? stats.finalMind ?? 0) || 0;
        const text = asText(type);
        if (/魂力/.test(text)) return soul;
        if (/精神/.test(text)) return mind;
        if (/混合/.test(text)) return (body + soul + mind) / 3;
        return body;
    }

    function combatDefenseValue(stats, type) {
        const body = Number(stats.body ?? stats.肉体 ?? stats.finalBody ?? 0) || 0;
        const soul = Number(stats.soul ?? stats.魂力 ?? stats.finalSoul ?? 0) || 0;
        const mind = Number(stats.mind ?? stats.精神 ?? stats.finalMind ?? 0) || 0;
        const text = asText(type);
        if (/魂力/.test(text)) return soul * 0.70 + body * 0.15 + mind * 0.15;
        if (/精神/.test(text)) return mind * 0.85 + soul * 0.15;
        if (/混合/.test(text)) return (body * 0.85 + soul * 0.70 + mind * 0.85) / 3;
        return body * 0.85 + soul * 0.15;
    }

    function normalizeCombatAttribute(value) {
        return asText(value)
            .replace(/极致之?/g, '')
            .replace(/属性|元素|攻击|伤害|效果|类型|系/g, '')
            .replace(/[=：:]/g, '')
            .trim();
    }

    function splitCombatAttributes(value) {
        if (Array.isArray(value)) return value.flatMap(splitCombatAttributes);
        const text = asText(value);
        if (!text) return [];
        return text
            .split(/[\/,，、;；|]/)
            .map(normalizeCombatAttribute)
            .filter(Boolean);
    }

    function taggedExtremeAttributes(value) {
        const text = asText(value);
        if (!text) return [];
        const out = [];
        text.replace(/极致属性\s*[=：:]\s*([^;；,，、\/|]+)/g, (_, attr) => {
            out.push(...splitCombatAttributes(attr));
            return _;
        });
        text.replace(/极致之?([^;；,，、\/|\s]+)/g, (_, attr) => {
            out.push(...splitCombatAttributes(attr));
            return _;
        });
        return out;
    }

    function collectExtremeAttributes(source) {
        const attrs = [];
        function add(value) { attrs.push(...splitCombatAttributes(value)); }
        function addTagged(value) { attrs.push(...taggedExtremeAttributes(value)); }
        if (!source) return attrs;
        if (typeof source === 'string' || Array.isArray(source)) {
            addTagged(source);
            return attrs;
        }
        add(source.extremeAttribute);
        add(source.extremeAttributes);
        add(source.极致属性);
        add(source.极致属性列表);
        addTagged(source.简介与描述);
        addTagged(source.计算备注);
        if (source.isExtreme || yes(source.是否极致) || yes(source.是否极致_脚本)) {
            add(source.特殊属性);
            add(source.规则属性);
        }
        return attrs;
    }

    function combatTextMatchesAttribute(attribute, text) {
        const attr = normalizeCombatAttribute(attribute);
        if (!attr) return false;
        const haystack = asText(text).replace(/\s+/g, '');
        if (!haystack) return false;
        return haystack.includes(attr) || haystack.includes(`极致${attr}`) || haystack.includes(`${attr}属性`);
    }

    function extremeCombatBonus(input, attacker, attackType, defenseType) {
        const attrs = Array.from(new Set([
            ...collectExtremeAttributes(attacker),
            ...collectExtremeAttributes(input),
        ]));
        const targetText = [
            attackType,
            defenseType,
            input.damageType,
            input.effectType,
            input.damageElement,
            input.伤害类型,
            input.效果类型,
            input.伤害属性,
            input['伤害/效果类型'],
        ].map(asText).filter(Boolean).join(';');
        const matched = attrs.filter(attr => combatTextMatchesAttribute(attr, targetText));
        const forced = input.isExtremeAttack || input.极致攻击;
        const active = matched.length > 0 || yes(forced);
        return {
            active,
            multiplier: active ? EXTREME_ATTACK_MULTIPLIER : 1,
            attributes: attrs,
            matched: matched.length ? matched : (active ? ['强制极致攻击'] : []),
            note: active ? `极致属性命中:${matched.join('/') || '强制'};倍率=${EXTREME_ATTACK_MULTIPLIER}x` : '',
        };
    }

    function controlResult(ratio) {
        if (ratio <= 0.5) return '无效';
        if (ratio <= 0.75) return '轻微干扰';
        if (ratio <= 1.0) return '明显干扰';
        if (ratio <= 1.25) return '短暂限制';
        if (ratio <= 1.75) return '成功控制，持续1回合';
        if (ratio <= 2.5) return '强控制，持续1-2回合或附带破防/禁技';
        return '压倒性控制';
    }

    function calculateCombat(input = {}) {
        const attacker = input.attacker || {};
        const defender = input.defender || {};
        const attackType = input.attackType || input.type || '肉体攻击';
        const defenseType = input.defenseType || attackType.replace('攻击', '承受');
        const attackValue = combatAttackValue(attacker, attackType);
        const defenseValue = combatDefenseValue(defender, defenseType);
        const skillMultiplier = Number(input.skillMultiplier ?? input.multiplier ?? 1) || 1;
        const resistance = Number(input.resistance ?? 1) || 1;
        const hit = Number(input.hit ?? 1) || 1;
        const state = Number(input.state ?? 1) || 1;
        const adjustment = Number(input.adjustment ?? 0) || 0;
        const extreme = extremeCombatBonus(input, attacker, attackType, defenseType);
        const damage = Math.max(0, round(attackValue * skillMultiplier * extreme.multiplier * resistance * hit * state + adjustment));
        const controlMultiplier = Number(input.controlMultiplier ?? skillMultiplier) || 1;
        const controlStrength = attackValue * controlMultiplier * state * extreme.multiplier;
        const controlResistance = Math.max(1, defenseValue * (Number(input.antiControl ?? 1) || 1));
        const controlRatio = round(controlStrength / controlResistance);
        return {
            attackType,
            defenseType,
            attackValue: round(attackValue),
            defenseValue: round(defenseValue),
            extreme,
            damage,
            control: {
                strength: round(controlStrength),
                resistance: round(controlResistance),
                ratio: controlRatio,
                result: controlResult(controlRatio),
            },
        };
    }

    async function recalculate(options = {}) {
        if (isWriting) return { skipped: true, reason: '正在写入' };
        api = getDatabaseApi() || api || await waitForDatabaseApi();
        if (!api) {
            toast('未检测到 shujuku / AutoCardUpdaterAPI，无法计算数据库。', 'warning');
            return { ok: false, reason: 'AutoCardUpdaterAPI unavailable' };
        }

        const db = api.exportTableAsJson();
        if (!db) {
            toast('无法导出当前数据库。', 'warning');
            return { ok: false, reason: 'exportTableAsJson failed' };
        }

        const readiness = verifyDatabaseReady(db);
        if (!readiness.ok) {
            console.warn(`[${SCRIPT_NAME}] ${readiness.message}`, readiness.missing);
            toast(readiness.message, 'warning');
            return { ok: false, reason: 'database template incomplete', missingTables: readiness.missing };
        }

        const inputHash = stableHash({
            stats: rows(db, CONFIG.tables.stats),
            player: rows(db, CONFIG.tables.player),
            traits: rows(db, CONFIG.tables.traits),
            traitState: rows(db, CONFIG.tables.traitState),
            traitRules: rows(db, CONFIG.tables.traitRules),
            traitAttributeRules: rows(db, CONFIG.tables.traitAttributeRules),
            traitEquipmentSlots: rows(db, CONFIG.tables.traitEquipmentSlots),
            traitTempStates: rows(db, CONFIG.tables.traitTempStates),
            skills: rows(db, CONFIG.tables.skills),
            soulOverview: rows(db, CONFIG.tables.soulOverview),
            rings: CONFIG.tables.rings.map(name => rows(db, name)),
            soulBones: rows(db, CONFIG.tables.soulBones),
            spirits: rows(db, CONFIG.tables.spirits),
            armor: rows(db, CONFIG.tables.armor),
            soulDevices: rows(db, CONFIG.tables.soulDevices),
            titlePanel: rows(db, CONFIG.tables.titlePanel),
        });
        if (!options.force && inputHash === lastInputHash) {
            log('输入未变化，跳过重算');
            return { ok: true, skipped: true };
        }
        lastInputHash = inputHash;

        const statsRow = firstRow(db, CONFIG.tables.stats);
        if (/是|锁定|true|1/i.test(asText(cell(statsRow, '自动计算锁定')))) {
            toast('人物综合数值面板已锁定，跳过自动计算。', 'info');
            return { ok: true, skipped: true, reason: 'locked' };
        }

        isWriting = true;
        try {
            const playerRow = firstRow(db, CONFIG.tables.player);
            const level = parseLevel(statsRow, playerRow);
            const traits = collectTraits(db);
            const attrRules = collectTraitAttributeRules(db, traits);
            const dslRules = collectDslRules(db, traits);
            const dailyBonuses = collectDailyBonuses(db);
            const ruleDiagnostics = [];
            const ruleState = { attrRules, dslRules, diagnostics: ruleDiagnostics, daily: dailyBonuses.daily, flags: {} };
            const ctx = martialContext(db, traits);
            const stateText = activeText(db);

            const updates = [];
            updates.push(...refreshTraitEquipmentSlots(db, traits));

            const overviewUpdateBase = {
                '多武魂倍率策略_脚本': ctx.hasLink ? '武魂串联：最高两个倍率求和' : '默认：最高倍率',
                '全局总先天魂力_脚本': String(ctx.totalInnate),
                '全局综合倍率_脚本': `${round(ctx.multiplier)}x`,
                '全局倍率来源_脚本': `${ctx.source};总先天魂力综合倍率参考=${round(ctx.byTotal)}x`,
            };
            for (const info of ctx.rows) {
                if (!info.row.__rowIndex) continue;
                updates.push({
                    table: CONFIG.tables.soulOverview,
                    rowIndex: info.row.__rowIndex,
                    data: {
                        '先天等级_脚本': `${info.quality.level}级`,
                        '倍率与经验效率_脚本': `倍率:${info.quality.multiplier}x;经验效率:${info.quality.exp}`,
                        '是否极致_脚本': info.isExtreme ? '是' : '否',
                        '共鸣率_脚本': info.isBody ? `${round(info.resonance * 100)}%` : '不适用',
                        ...overviewUpdateBase,
                        '计算备注': `品质=${info.quality.key};觉醒=${info.awakened ? '是' : '否'}`,
                    },
                });
            }

            const ringMartial = bonus();
            for (const tableName of CONFIG.tables.rings) {
                for (const row of rows(db, tableName)) {
                    if (empty(cell(row, '魂环序号')) && empty(cell(row, '魂环年限')) && empty(cell(row, '魂技名称'))) continue;
                    const result = calcRingBonus(row, traits, attrRules, ruleDiagnostics);
                    addTri(ringMartial, result.tri);
                    updates.push({
                        table: tableName,
                        rowIndex: row.__rowIndex,
                        data: {
                            '肉体加成_脚本': String(round(result.tri.body)),
                            '魂力加成_脚本': String(round(result.tri.soul)),
                            '精神加成_脚本': String(round(result.tri.mind)),
                            '加成计算备注': `年份=${Math.floor(result.year)};${result.note}`,
                        },
                    });
                }
            }

            const equipment = collectEquipment(db);
            let base = bonus(
                num(cell(statsRow, '肉体_基础'), CONFIG.defaults.baseAttr),
                num(cell(statsRow, '魂力_基础'), CONFIG.defaults.baseAttr),
                num(cell(statsRow, '精神_基础'), CONFIG.defaults.baseAttr),
            );
            let manualOther = bonus(
                num(cell(statsRow, '肉体_其余加成'), 0),
                num(cell(statsRow, '魂力_其余加成'), 0),
                num(cell(statsRow, '精神_其余加成'), 0),
            );

            const martialRaw = bonus();
            addTri(martialRaw, ringMartial);
            addTri(martialRaw, equipment.martial);

            const other = bonus();
            addTri(other, manualOther);
            addTri(other, equipment.other);

            const finalCalc = calcFinals(base, martialRaw, other, ctx, traits, stateText, ruleState);
            const maxRes = resourceMax(level, finalCalc.final, equipment.resources, traits, stateText, ruleState);
            const realm = spiritRealm(maxRes.spirit);
            const scale = battleScale(finalCalc.final.body, finalCalc.final.soul, finalCalc.final.mind);
            const pointState = pointGrowthState(statsRow, playerRow);

            const statsUpdate = {
                '魂力等级': String(level),
                '魂师境界': soulRealm(level),
                '精神力境界_脚本': realm,
                '血量上限_脚本': String(maxRes.hp),
                '蓝量上限_脚本': String(maxRes.mp),
                '精神力上限_脚本': String(maxRes.spirit),
                '肉体_武魂相关_脚本': String(round(finalCalc.martialScript.body)),
                '魂力_武魂相关_脚本': String(round(finalCalc.martialScript.soul)),
                '精神_武魂相关_脚本': String(round(finalCalc.martialScript.mind)),
                '肉体_最终_脚本': String(round(finalCalc.final.body)),
                '魂力_最终_脚本': String(round(finalCalc.final.soul)),
                '精神_最终_脚本': String(round(finalCalc.final.mind)),
                '日常六维与调整值': [
                    asText(cell(statsRow, '日常六维与调整值')),
                    dailyBonuses.details.length ? `称号调整=${dailyBonuses.details.join('|')}` : '',
                ].filter(Boolean).join(';'),
                '特性点': String(pointState.after.sp),
                '红尘点': String(pointState.after.dp),
                '计算备注': [
                    `v${VERSION}`,
                    `武魂倍率=${finalCalc.multiplier}x`,
                    `真身=${finalCalc.avatar ? '是' : '否'}`,
                    `本体共鸣=${round(finalCalc.resonanceRate * 100)}%`,
                    pointState.note,
                    `魂环武魂原始=${formatTri(ringMartial)}`,
                    `装备武魂原始=${formatTri(equipment.martial)}`,
                    `装备其余=${formatTri(equipment.other)}`,
                    ruleDiagnostics.slice(0, 8).join('|'),
                    equipment.details.slice(0, 5).join('|'),
                ].filter(Boolean).join(';'),
            };
            const hpClamp = clampCurrentValue(cell(statsRow, '血量当前'), maxRes.hp, '血量', ruleDiagnostics);
            const mpClamp = clampCurrentValue(cell(statsRow, '蓝量当前'), maxRes.mp, '蓝量', ruleDiagnostics);
            const spiritClamp = clampCurrentValue(cell(statsRow, '精神力当前'), maxRes.spirit, '精神力', ruleDiagnostics);
            if (hpClamp.changed) statsUpdate['血量当前'] = hpClamp.value;
            if (mpClamp.changed) statsUpdate['蓝量当前'] = mpClamp.value;
            if (spiritClamp.changed) statsUpdate['精神力当前'] = spiritClamp.value;
            if (hpClamp.reason || mpClamp.reason || spiritClamp.reason) {
                statsUpdate['计算备注'] += `;当前值处理=${[hpClamp.reason, mpClamp.reason, spiritClamp.reason].filter(Boolean).join('|')}`;
            }

            const failedWrites = [];
            failedWrites.push(...await updateRows(updates, { quiet: true }));
            const statsResult = await upsertFirstRow(CONFIG.tables.stats, statsRow, statsUpdate, { quiet: true });
            if (apiWriteFailed(statsResult)) failedWrites.push(`${CONFIG.tables.stats}:upsert failed`);
            if (playerRow && playerRow.__rowIndex) {
                const playerResult = await updateRowCompat(CONFIG.tables.player, playerRow.__rowIndex, {
                    '魂力等级': String(level),
                    '战力标尺定位_脚本': scale,
                }, { quiet: true });
                if (apiWriteFailed(playerResult)) failedWrites.push(`${CONFIG.tables.player}:updateRow failed`);
            }

            if (CONFIG.refreshAfterWrite && typeof api.refreshDataAndWorldbook === 'function') {
                await api.refreshDataAndWorldbook();
            }
            if (failedWrites.length) {
                toast(`重算完成，但有${failedWrites.length}项写入失败，请查看控制台诊断。`, 'warning');
            } else {
                toast(`重算完成：${soulRealm(level)} / ${realm} / ${scale}`, 'success');
            }
            return { ok: failedWrites.length === 0, level, realm, scale, pointState, failedWrites };
        } catch (error) {
            console.error(`[${SCRIPT_NAME}]`, error);
            toast(`重算失败：${error.message || error}`, 'error');
            return { ok: false, error };
        } finally {
            isWriting = false;
        }
    }

    function autoEnabled() {
        return localStorage.getItem(STORAGE_KEY) === '1';
    }

    function setAutoEnabled(enabled) {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    }

    function startAuto() {
        stopAuto(false);
        timer = setInterval(() => recalculate({ force: false }), CONFIG.autoIntervalMs);
        setAutoEnabled(true);
        toast('已开启自动重算。', 'success');
        recalculate({ force: true });
    }

    function stopAuto(showToast = true) {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        setAutoEnabled(false);
        if (showToast) toast('已关闭自动重算。', 'info');
    }

    function toggleAuto() {
        if (timer || autoEnabled()) stopAuto(true);
        else startAuto();
    }

    function status() {
        const message = `版本 ${VERSION}；自动重算：${timer || autoEnabled() ? '开' : '关'}；间隔 ${CONFIG.autoIntervalMs / 1000}s`;
        toast(message, 'info');
        return message;
    }

    async function init() {
        api = await waitForDatabaseApi(20000);
        if (!api) {
            toast('未检测到数据库 API。导入脚本后，请确认神·数据库 / SP·数据库 II/III 已加载。', 'warning');
            return;
        }
        if (autoEnabled()) {
            timer = setInterval(() => recalculate({ force: false }), CONFIG.autoIntervalMs);
            recalculate({ force: true });
        }
        log('ready');
    }

    const publicApi = {
        version: VERSION,
        recalculate: () => recalculate({ force: true }),
        getPointState,
        pointGrowthForLevel,
        previewCreationMapping,
        applyCreationPayload,
        diagnose,
        checkDatabaseReady: () => verifyDatabaseReady(api && typeof api.exportTableAsJson === 'function' ? api.exportTableAsJson() : null),
        checkCoreDatabaseReady: () => verifyDatabaseReady(api && typeof api.exportTableAsJson === 'function' ? api.exportTableAsJson() : null, CORE_RECALC_TABLES),
        checkFullTemplateReady: () => verifyDatabaseReady(api && typeof api.exportTableAsJson === 'function' ? api.exportTableAsJson() : null, REQUIRED_TEMPLATE_TABLES),
        calculateCombat,
        toggleAuto,
        startAuto,
        stopAuto,
        status,
    };

    for (const host of hostWindows()) {
        try {
            host.DouLuoV03AutoCalc = publicApi;
        } catch (_) {}
    }

    init();
})();
