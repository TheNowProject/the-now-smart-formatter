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


function formatTypescriptImports(importsText: string): string {
    const imports = importsText.split(/\n/g).map((i) => i.trim())
    const sortedImports = [...imports]
        .sort((a, b) => {
            // Prioritize type imports, then curly braces, then default imports
            const aType = a.includes('import type')
            const bType = b.includes('import type')
            if (aType !== bType) {
                return aType ? -1 : 1
            }

            const aCurly = a.includes('import {')
            const bCurly = b.includes('import {')
            if (aCurly !== bCurly) {
                return aCurly ? -1 : 1
            }

            const aDefault = a.includes('import ')
            const bDefault = b.includes('import ')
            if (aDefault !== bDefault) {
                return aDefault ? -1 : 1
            }

            return 0
        })
        .sort((a, b) => {
            const re = /import\s+(.*?)\s+from.*/g
            const aImports = [...a.matchAll(re)][0]?.[1]
            const bImports = [...b.matchAll(re)][0]?.[1]

            return -((aImports ?? '').length - (bImports ?? '').length)
        })
    return sortedImports.join('\n')
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('prisma-smart-formatter.formatPrismaModelsImports', async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }

        const document = editor.document
        if (document.languageId !== 'typescript') {
            return
        }

        await editor.edit((editBuilder) => {
            let section = []
            let lineNumber: number | null = null

            for (const line of document.getText().split(/\n/g)) {
                lineNumber = lineNumber === null ? 0 : lineNumber + 1

                if (line.trim().startsWith('import')) {
                    section.push(line)
                    continue
                }

                if (!section.length) {
                    continue
                }

                const formattedSection = formatTypescriptImports(section.join('\n'))
                editBuilder.replace(
                    new vscode.Range(
                        new vscode.Position(lineNumber! - section.length, 0),
                        new vscode.Position(lineNumber!, 0)
                    ),
                    formattedSection + '\n'
                )
                section = []
            }
        })
    }))

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('typescript', {
        async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
            const config = vscode.workspace.getConfiguration('editor', { languageId: 'typescript' })
            const defaultTypescriptFormatter = config.get('defaultFormatter') as string | undefined

            await config.update('defaultFormatter', defaultTypescriptFormatter ?? 'vscode.typescript-language-features', true)
            await vscode.commands.executeCommand('editor.action.formatDocument')
            await vscode.commands.executeCommand('prisma-smart-formatter.formatPrismaModelsImports')

            await config.update('defaultFormatter', 'KhanhhNe.prisma-smart-formatter', true)

            return []
        }
    }))

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('typescriptreact', {
        async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
            const config = vscode.workspace.getConfiguration('editor', { languageId: 'typescript' })
            const defaultTypescriptFormatter = config.get('defaultFormatter') as string | undefined
            vscode.window.showInformationMessage(defaultTypescriptFormatter ?? 'vscode.typescript-language-features')

            await config.update('defaultFormatter', defaultTypescriptFormatter ?? 'vscode.typescript-language-features', true)
            await vscode.commands.executeCommand('editor.action.formatDocument')
            await vscode.commands.executeCommand('prisma-smart-formatter.formatPrismaModelsImports')

            await config.update('defaultFormatter', 'KhanhhNe.prisma-smart-formatter', true)

            return []
        }
    }))


    context.subscriptions.push(vscode.commands.registerTextEditorCommand('prisma-smart-formatter.formatPrismaModels', async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }

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

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('prisma', {
        async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
            const config = vscode.workspace.getConfiguration('editor', { languageId: 'prisma' })
            await config.update("defaultFormatter", "Prisma.prisma", true)
            await vscode.commands.executeCommand('editor.action.formatDocument')
            await vscode.commands.executeCommand('prisma-smart-formatter.formatPrismaModels')

            await config.update("defaultFormatter", "KhanhhNe.prisma-smart-formatter", true)

            return []
        }
    }))
}

// This method is called when your extension is deactivated
export function deactivate() { }
