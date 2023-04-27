// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'

function parseLine(line: string): [string, string, string, string[]] {
    const [name, colType, ...tags] = line.trim().split(/\s+/)
    let parsedTags: string[] = [...tags.join(' ').matchAll(/(@[^@]+)/g)]
        .map((m) => m[0])
        .map(t => t.trim())
        .filter(Boolean)

    const expectedLine = `${name} ${colType} ${parsedTags.join(' ')}`.replace(/\s+/g, '')

    if (line.replace(/\s+/g, '') !== expectedLine) {
        throw new Error(`Unexpected format in line: ${line}`)
    }

    let mapPart = ''

    for (let i = 0; i < parsedTags.length; i++) {
        const t = parsedTags[i]
        if (t.startsWith('@map') || t.startsWith('@relation')) {
            parsedTags.splice(i, 1)
            mapPart = t
            break
        }
    }

    return [name, colType, mapPart, parsedTags]
}


function formatPrismaModelContent(modelContent: string[]): string[] {
    const lines = modelContent.map(line => line.trim())
    const modelLines: [string, string, string, string[]][] = lines.map(line => {
        try {
            return parseLine(line)
        } catch (e) {
            return [line, '', '', []]
        }
    })

    const nameLongest = modelLines
        .filter(([name]) => !name.startsWith('@'))
        .reduce((acc, [name]) => Math.max(acc, name.length), 0)
    const typeLongest = modelLines
        .filter(([name]) => !name.startsWith('@'))
        .reduce((acc, [, colType]) => Math.max(acc, colType.length), 0)
    const mapLongest = modelLines
        .filter(([_, __, mapPart]) => mapPart.startsWith('@map'))
        .reduce((acc, [, , mapPart]) => Math.max(acc, mapPart.length), 0)

    const newLines = []
    for (const [name, colType, mapPart, tags] of modelLines) {
        const line = `  ` +
            `${name.padEnd(nameLongest)} ${colType.padEnd(typeLongest)} ` +
            `${mapPart.padEnd(mapLongest)} ${tags.join(' ').trimEnd()}`
        newLines.push(line.trimEnd())
    }
    return newLines
}


function formatTypescriptImports(imports: string[]): string[] {
    const rawImports = imports.map(i => i.trim())
    const typeImports = rawImports.filter(i => i.includes('import type'))
    const curlyMultilineImports = rawImports.filter(i => i.includes('import {') && i.includes('\n'))
    const curlyImports = rawImports.filter(i => i.includes('import {') && !curlyMultilineImports.includes(i))
    const defaultImports = rawImports
        .filter(i =>
            !typeImports.includes(i) &&
            !curlyImports.includes(i) &&
            !curlyMultilineImports.includes(i))

    const cmpFunc = (a: string, b: string) => {
        const re = /import\s+(?:type\s+)?(.*?)\s+from\s+.*/gs
        const aImports = [...a.matchAll(re)][0]?.[1]
        const bImports = [...b.matchAll(re)][0]?.[1]

        return -((aImports ?? '').length - (bImports ?? '').length)
    }

    const processedCurlyMultilineImports = curlyMultilineImports.map(importLine => {
        // Sort the lines (of attributes inside the { }) by their descending length
        const parts = importLine.split(/\n+/)
        const importKeyword = parts[0]
        const fromStatement = parts[parts.length - 1]
        const attributes = parts
            .slice(1, parts.length - 1)
            .sort((a, b) => b.length - a.length)

        return (
            `${importKeyword}\n` +
            `${attributes.join('\n')}\n` +
            `${fromStatement}`
        )
    })

    return [
        ...typeImports.sort(cmpFunc),
        ...curlyImports.sort(cmpFunc),
        ...processedCurlyMultilineImports.sort(cmpFunc),
        ...defaultImports.sort(cmpFunc)
    ]
}


let isRunning = false

// template T
async function avoidRaceFormat<T>(func: () => Promise<T[]>): Promise<T[]> {
    if (isRunning) {
        return []
    }
    isRunning = true
    try {
        return await func()
    } finally {
        isRunning = false
    }
}


const customFormatters = {
    typescript: ['sortTypescriptImports'],
    typescriptreact: ['sortTypescriptImports'],
    prisma: ['formatPrismaModels']
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('prisma-smart-formatter.sortTypescriptImports', async (editor: vscode.TextEditor) => {
        const document = editor.document
        if (document.languageId !== 'typescript' && document.languageId !== 'typescriptreact') {
            return
        }

        await editor.edit((editBuilder) => {
            let section = []

            const splittedImports = document.getText().split(/(?:(\s+)(?=import ))|(?:\n(?=\n\S))/g)
            for (let index = 0; index < splittedImports.length; index += 2) {
                const line = splittedImports[index]
                const delimiter = splittedImports[index + 1]

                if (line.startsWith('import')) {
                    section.push(line)
                    if (delimiter === '\n') {
                        continue
                    }
                }

                if (section.length === 0) {
                    continue
                }

                const formattedSection = formatTypescriptImports(section)
                if (formattedSection.join('\n') !== section.join('\n')) {
                    const firstPos = document.getText().indexOf(section.join('\n'))

                    editBuilder.replace(
                        new vscode.Range(
                            document.positionAt(firstPos),
                            document.positionAt(firstPos + section.join('\n').length)
                        ),
                        formattedSection.join('\n')
                    )
                }
                section = []
            }
        })
    }))

    context.subscriptions.push(vscode.commands.registerTextEditorCommand('prisma-smart-formatter.formatPrismaModels', async (editor: vscode.TextEditor) => {
        const document = editor.document
        if (document.languageId !== 'prisma') {
            return
        }

        await editor.edit((editBuilder) => {
            let lines = []
            let lineNumber: number | null = null

            for (const line of document.getText().split(/\n/g)) {
                lineNumber = lineNumber === null ? 0 : lineNumber + 1

                if (line.startsWith('model') || lines.length > 0) {
                    lines.push(line)

                    if (!line.startsWith('}')) {
                        continue
                    }
                }

                if (lines.length === 0) {
                    continue
                }

                const formattedLines = formatPrismaModelContent(lines.slice(1, -1))
                editBuilder.replace(
                    new vscode.Range(
                        new vscode.Position(lineNumber! - lines.length + 2, 0),
                        new vscode.Position(lineNumber! - 1, lines[lines.length - 2].length)
                    ),
                    `${formattedLines.join('\n')}`
                )
                lines = []
            }
        })
    }))

    async function provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
        return await avoidRaceFormat(async () => {
            const languageConfig = vscode.workspace.getConfiguration()
            const currentConfig = languageConfig.get(`[${document.languageId}]`)
            const defaultFormatter =
                currentConfig?.['editor.defaultFormatter' as keyof typeof currentConfig] ||
                extensionConfig.get(`${document.languageId}.defaultFormatter}`)

            if (defaultFormatter && defaultFormatter !== 'KhanhhNe.prisma-smart-formatter') {
                await languageConfig.update(`[${document.languageId}]`, {
                    ...currentConfig as object,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    "editor.defaultFormatter": defaultFormatter
                })
                await vscode.commands.executeCommand('editor.action.formatDocument')
                await languageConfig.update(`[${document.languageId}]`, currentConfig)
            }

            for (const formatter of customFormatters[document.languageId as keyof typeof customFormatters]) {
                await vscode.commands.executeCommand(`prisma-smart-formatter.${formatter}`)
            }

            return []
        })
    }

    const extensionConfig = vscode.workspace.getConfiguration('prisma-smart-formatter')

    for (const languageId in customFormatters) {
        const languageConfig = vscode.workspace.getConfiguration()
        const currentConfig = languageConfig.get(`[${languageId}]`) || {}
        const currentDefaultFormatter = currentConfig['editor.defaultFormatter' as keyof typeof currentConfig]

        if (currentDefaultFormatter && currentDefaultFormatter !== 'KhanhhNe.prisma-smart-formatter') {
            await extensionConfig.update(`${languageId}.defaultFormatter`, currentDefaultFormatter)
        }

        context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(languageId, { provideDocumentFormattingEdits }))
    }
}

// This method is called when your extension is deactivated
export function deactivate() { }
