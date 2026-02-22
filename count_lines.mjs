import fs from 'fs';
import path from 'path';

function countFiles(dir, exts) {
    let fileList = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            fileList = fileList.concat(countFiles(fullPath, exts));
        } else {
            if (exts.includes(path.extname(fullPath))) {
                fileList.push(fullPath);
            }
        }
    }
    return fileList;
}

const files = countFiles('./src', ['.js']);
const stats = [];

for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    const size = Buffer.byteLength(code, 'utf8');
    const lines = code.split('\n');
    const totalLines = lines.length;

    // Logical lines: exclude blanks, pure comments, and lines that are just brackets
    let logicalLines = 0;
    let inBlockComment = false;

    for (let raw of lines) {
        let line = raw.trim();
        if (!line) continue;

        if (inBlockComment) {
            if (line.includes('*/')) inBlockComment = false;
            continue;
        }

        if (line.startsWith('/*')) {
            if (!line.includes('*/')) inBlockComment = true;
            continue;
        }

        if (line.startsWith('//')) continue;

        // Filter out lines that are JUST punctuation (brackets, braces, commas, semicolons)
        const punctuationOnly = /^[{}[\](),;]+$/;
        if (punctuationOnly.test(line)) continue;

        logicalLines++;
    }

    stats.push({
        file: f.replace(/\\/g, '/'),
        size,
        totalLines,
        logicalLines
    });
}

stats.sort((a, b) => b.size - a.size);

let markdown = '| File | Size (Bytes) | Total Lines | Logical Lines |\n|---|---|---|---|\n';
let totalSize = 0, totalL = 0, totalLog = 0;

for (const s of stats) {
    markdown += `| \`${s.file}\` | ${s.size} | ${s.totalLines} | ${s.logicalLines} |\n`;
    totalSize += s.size;
    totalL += s.totalLines;
    totalLog += s.logicalLines;
}

markdown += `| **Total (${stats.length} files)** | **${totalSize}** | **${totalL}** | **${totalLog}** |\n`;

console.log(markdown);
