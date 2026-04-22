const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, TabStopPosition, TabStopType,
} = require('docx')

// ── Markdown parser (lightweight, handles our docs) ──────────────────────────

function parseMD(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0
  let inCode = false
  let codeLines = []
  let inTable = false
  let tableRows = []

  while (i < lines.length) {
    const line = lines[i]

    // Code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', text: codeLines.join('\n') })
        codeLines = []
        inCode = false
      } else {
        if (inTable) { blocks.push({ type: 'table', rows: tableRows }); tableRows = []; inTable = false }
        inCode = true
      }
      i++; continue
    }
    if (inCode) { codeLines.push(line); i++; continue }

    // Table rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^[-:\s]+$/.test(c))) { i++; continue } // separator
      if (!inTable) inTable = true
      tableRows.push(cells)
      i++; continue
    } else if (inTable) {
      blocks.push({ type: 'table', rows: tableRows }); tableRows = []; inTable = false
    }

    // Headings
    const hMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (hMatch) {
      blocks.push({ type: 'heading', level: hMatch[1].length, text: hMatch[2].replace(/[*_`]/g, '') })
      i++; continue
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) { i++; continue }

    // Blockquote
    if (line.startsWith('>')) {
      blocks.push({ type: 'quote', text: line.replace(/^>\s*/, '') })
      i++; continue
    }

    // Bullet list
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push({ type: 'bullet', text: line.replace(/^\s*[-*]\s+/, '') })
      i++; continue
    }

    // Numbered list
    if (/^\s*\d+[.)]\s/.test(line)) {
      blocks.push({ type: 'numbered', text: line.replace(/^\s*\d+[.)]\s+/, '') })
      i++; continue
    }

    // Empty line
    if (!line.trim()) { i++; continue }

    // Plain paragraph
    blocks.push({ type: 'para', text: line })
    i++
  }
  if (inTable && tableRows.length) blocks.push({ type: 'table', rows: tableRows })
  return blocks
}

// ── Text run parser (handles **bold**, `code`, *italic*) ─────────────────────

function parseInline(text) {
  const runs = []
  const re = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|__(.+?)__)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size: 20, font: 'Calibri' }))
    if (m[2]) runs.push(new TextRun({ text: m[2], bold: true, size: 20, font: 'Calibri' }))
    else if (m[3]) runs.push(new TextRun({ text: m[3], size: 18, font: 'Consolas', shading: { type: ShadingType.SOLID, color: 'F1F5F9', fill: 'F1F5F9' } }))
    else if (m[4] || m[5]) runs.push(new TextRun({ text: m[4] || m[5], italics: true, size: 20, font: 'Calibri' }))
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: 20, font: 'Calibri' }))
  if (runs.length === 0) runs.push(new TextRun({ text, size: 20, font: 'Calibri' }))
  return runs
}

// ── Block to docx element ────────────────────────────────────────────────────

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
}

function cellBorder() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
  }
}

function blocksToDocx(blocks) {
  const elements = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        elements.push(new Paragraph({
          heading: HEADING_MAP[b.level] || HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: b.text, font: 'Calibri', bold: true })],
        }))
        break

      case 'para':
        elements.push(new Paragraph({
          spacing: { after: 120 },
          children: parseInline(b.text),
        }))
        break

      case 'quote':
        elements.push(new Paragraph({
          spacing: { after: 80 },
          indent: { left: 400 },
          children: [new TextRun({ text: b.text, italics: true, color: '64748B', size: 20, font: 'Calibri' })],
        }))
        break

      case 'bullet':
        elements.push(new Paragraph({
          spacing: { after: 60 },
          bullet: { level: 0 },
          children: parseInline(b.text),
        }))
        break

      case 'numbered':
        elements.push(new Paragraph({
          spacing: { after: 60 },
          numbering: { reference: 'default-numbering', level: 0 },
          children: parseInline(b.text),
        }))
        break

      case 'code':
        for (const codeLine of b.text.split('\n')) {
          elements.push(new Paragraph({
            spacing: { after: 0 },
            shading: { type: ShadingType.SOLID, color: 'F8FAFC', fill: 'F8FAFC' },
            indent: { left: 200 },
            children: [new TextRun({ text: codeLine || ' ', font: 'Consolas', size: 17, color: '334155' })],
          }))
        }
        elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        break

      case 'table':
        if (b.rows.length === 0) break
        const colCount = b.rows[0].length
        const tRows = b.rows.map((cells, ri) =>
          new TableRow({
            children: cells.map(cell =>
              new TableCell({
                borders: cellBorder(),
                shading: ri === 0 ? { type: ShadingType.SOLID, color: 'F1F5F9', fill: 'F1F5F9' } : undefined,
                children: [new Paragraph({
                  spacing: { after: 40, before: 40 },
                  children: ri === 0
                    ? [new TextRun({ text: cell, bold: true, size: 18, font: 'Calibri' })]
                    : parseInline(cell),
                })],
              })
            ),
          })
        )
        elements.push(new Table({
          rows: tRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }))
        elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        break
    }
  }
  return elements
}

// ── Build DOCX from markdown file ────────────────────────────────────────────

async function convert(mdPath, docxPath, title) {
  const md = fs.readFileSync(mdPath, 'utf-8')
  const blocks = parseMD(md)
  const elements = blocksToDocx(blocks)

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    styles: {
      default: {
        heading1: { run: { size: 36, bold: true, font: 'Calibri', color: '0F172A' }, paragraph: { spacing: { before: 360, after: 160 } } },
        heading2: { run: { size: 28, bold: true, font: 'Calibri', color: '1E293B' }, paragraph: { spacing: { before: 280, after: 120 } } },
        heading3: { run: { size: 24, bold: true, font: 'Calibri', color: '334155' }, paragraph: { spacing: { before: 200, after: 100 } } },
        heading4: { run: { size: 22, bold: true, font: 'Calibri', color: '475569' }, paragraph: { spacing: { before: 160, after: 80 } } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      children: [
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: 'SpendGuard', size: 48, bold: true, font: 'Calibri', color: '0F172A' })],
        }),
        new Paragraph({
          spacing: { after: 400 },
          children: [new TextRun({ text: title, size: 28, font: 'Calibri', color: '64748B' })],
        }),
        ...elements,
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(docxPath, buffer)
  console.log(`Created: ${docxPath} (${(buffer.length / 1024).toFixed(0)} KB)`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dir = __dirname
  const files = [
    ['PRODUCT.md',      'SpendGuard - Product Document.docx',      'Product Document'],
    ['ARCHITECTURE.md', 'SpendGuard - Technical Architecture.docx', 'Technical Architecture'],
    ['API.md',          'SpendGuard - API Reference.docx',          'API Reference'],
    ['DEPLOYMENT.md',   'SpendGuard - Deployment Guide.docx',       'Deployment Guide'],
  ]
  for (const [md, docx, title] of files) {
    await convert(path.join(dir, md), path.join(dir, docx), title)
  }
  console.log('\nAll DOCX files generated.')
}

main().catch(e => { console.error(e); process.exit(1) })
