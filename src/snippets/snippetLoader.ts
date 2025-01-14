import {
	ExtensionContext,
	TreeItemCollapsibleState,
  extensions,
	window,
	workspace
} 
from 'vscode';
import {
	SnippetLanguage, 
	SnippetFile, 
	Snippet
} 
from './snippets'
import * as config from '../config';
import * as jsonc from 'jsonc-parser';
import * as fs from 'fs';
import * as path from 'path';

export class SnippetLoader {

	public snippetLanguages: Map<string, SnippetLanguage> = new Map<string, SnippetLanguage>();

	constructor(private context: ExtensionContext) {
  }

	async getSnippetLanguages(): Promise<SnippetLanguage[]> {
		this.snippetLanguages.clear();
  	// get snippet languages from extension snippet files
		const snippetLanguages: SnippetLanguage[] = [];
		const skipLanguages: string[] = config.skipLanguages();
		const showBuiltInExtensionSnippets = config.showBuiltInExtensionSnippets();
		const snippetFileCollapsibleState: TreeItemCollapsibleState = this.getSnippetFileCollapsibleState();
    extensions.all.forEach(extension => {
      if ((showBuiltInExtensionSnippets || !extension.packageJSON.isBuiltin) && 
					extension.packageJSON?.contributes?.snippets) {
				const extensionName = extension.packageJSON?.displayName;
				const extensionLocation = extension.packageJSON?.extensionLocation;
				const snippetsConfig = extension.packageJSON?.contributes?.snippets;
				if (extensionLocation && Array.isArray(snippetsConfig)) {
					snippetsConfig.forEach(snippetConfig => {
						const language: string = snippetConfig.language;
						if (skipLanguages.indexOf(language) < 0) {
							// create snippets file
							const snippetFile: SnippetFile = new SnippetFile(extensionName,
								path.join(extensionLocation.fsPath, snippetConfig.path),
								language,
								snippetFileCollapsibleState
							);
							if (!this.snippetLanguages.has(language)) {
								// create snippets language
								const snippetLanguage: SnippetLanguage = new SnippetLanguage(language);
								snippetLanguages.push(snippetLanguage);
								this.snippetLanguages.set(language, snippetLanguage);
							}
							// add snippet file to language snippets
							this.snippetLanguages.get(language)?.snippetFiles.push(snippetFile);
						}
					});
				}
			}
    });

		// get user defined snippet languages and files
		const userSnippetsDirectoryPath: string = path.join(
			this.context.globalStorageUri.fsPath, '..', '..', '..', 'User', 'snippets');
		const userSnippetFiles: SnippetFile[] = 
			await this.getDirectorySnippetFiles(userSnippetsDirectoryPath, 'User Snippets');

		// get project snippet languages and files
		const projectSnippetFiles: SnippetFile[] = await this.getProjectSnippetFiles();
		
		return Promise.resolve(snippetLanguages.sort((a, b) => a.language.localeCompare(b.language)));
	}

	async getProjectSnippetFiles(): Promise<SnippetFile[]> {
		return new Promise(async (resolve, reject) => {
			let snippetFiles: SnippetFile[] = [];
			const workspaceFolders = workspace.workspaceFolders;
			if (workspaceFolders) {
				snippetFiles = Array.prototype.concat.apply([], await Promise.all(
					workspaceFolders.map(async workspaceFolder => {
						const vscodeDirectoryPath: string = path.join(workspaceFolder.uri.fsPath, '.vscode');
						return this.getDirectorySnippetFiles(vscodeDirectoryPath, `/${workspaceFolder.name} Snippets`);
					})
				));
			}
			return resolve(snippetFiles);
		});
	}
	
	async getDirectorySnippetFiles(directoryPath: string, snippetFileLabel: string): Promise<SnippetFile[]> {
		const directoryExists: boolean = await this.directoryExists(directoryPath);
		if (!directoryExists) {
			return [];
		}
		return new Promise((resolve, reject) => {
			fs.readdir(directoryPath, (err, fileNames) => {
				if (err) {
					window.showErrorMessage(`Error reading directory: ${directoryPath} \n ${err.message}`);
					return reject([]);
				}
				const snippetFiles: SnippetFile[] = [];
				const skipLanguages: string[] = config.skipLanguages();
				fileNames.forEach(fileName => {
					const filePath: string = path.join(directoryPath, fileName);
					const language: string = path.parse(fileName).name.toLowerCase();
					if ((fileName.endsWith('.json') || fileName.endsWith('.code-snippets')) && 
							skipLanguages.indexOf(language) < 0) {
						const snippetFile: SnippetFile = 
							new SnippetFile(snippetFileLabel, filePath, language, this.getSnippetFileCollapsibleState());
						if (!this.snippetLanguages.has(language)) {
							// create new snippets language
							const snippetLanguage: SnippetLanguage = new SnippetLanguage(language);
							this.snippetLanguages.set(language, snippetLanguage);
						}
						// add snippet file to language snippets
						this.snippetLanguages.get(language)?.snippetFiles.push(snippetFile);
						snippetFiles.push(snippetFile);
					}
				});
				return resolve(snippetFiles);
			});
		});
	}

	async directoryExists(directoryPath: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			try {
				fs.stat(directoryPath, (err, file) => {
					if (!err && file.isDirectory()) {
						return resolve(true);
					} 
					else {
						return resolve(false);
					}
				});
			} catch (err) {
				return reject(false);
			}
		});
	}

	getSnippetFileCollapsibleState(): TreeItemCollapsibleState {
		if (config.expandSnippetFiles()) {
			return TreeItemCollapsibleState.Expanded;
		}
		return TreeItemCollapsibleState.Collapsed;
	}

	async getSnippetFiles(extensionId: string): Promise<SnippetFile[]> {
		const extension = extensions.getExtension(extensionId);
		let snippetFiles: SnippetFile[] = [];
		if (extension) {
			const extensionLocation = extension.packageJSON?.extensionLocation;
			const snippetsConfig = extension.packageJSON?.contributes?.snippets;
			if (extensionLocation && Array.isArray(snippetsConfig)) {
				const snippetFileCollapsibleState: TreeItemCollapsibleState = this.getSnippetFileCollapsibleState();
  			snippetsConfig.forEach(snippetConfig => {
					const snippetFile: SnippetFile = new SnippetFile(
						snippetConfig.language,
						path.join(extensionLocation.fsPath, snippetConfig.path),
						snippetConfig.language,
						snippetFileCollapsibleState
					);
					snippetFiles.push(snippetFile);
			  });
				await Promise.all(snippetFiles.map((file: SnippetFile) => this.getFileSnippets(file)));
			}
		}
		return Promise.resolve(snippetFiles);
	}

	async getSnippets(snippetLanguage: SnippetLanguage): Promise<Snippet[]> {
		const fileSnippets: Snippet[][] = await Promise.all(
			snippetLanguage.snippetFiles.map((file: SnippetFile) => this.getFileSnippets(file))
		);
		const snippets: Snippet[] = [];
		fileSnippets.forEach(file => file.map(snippet => snippets.push(snippet)));
		return Promise.resolve(snippets);
	}

	async getFileSnippets(snippetFile: SnippetFile): Promise<Snippet[]> {
		return new Promise((resolve, reject) => {
			fs.readFile(snippetFile.filePath, 'utf8', (error, snippetsConfig) => {
				if (error) {
					window.showErrorMessage(`Error reading file ${snippetFile.filePath} \n ${error.message}`);
					return reject([]);
				}
				if (snippetsConfig === '') {
					return resolve([]);
				}

				let parsedSnippets: any;
				try {
					parsedSnippets = jsonc.parse(snippetsConfig); // tslint:disable-line
				} 
        catch (err) {
					window.showErrorMessage(`JSON parsing of snippet file ${snippetFile.filePath} failed`);
					return reject([]);
				}

        // load parsed snippets
				const snippets: Snippet[] = [];
				for (const key in parsedSnippets) {
          const parsedSnippet = parsedSnippets[key];
					const scope = [snippetFile.language];
					const snippet: Snippet = new Snippet(key,	parsedSnippet.prefix, scope, 
						parsedSnippet.description, parsedSnippet.body, snippetFile);
					snippets.push(snippet);
				}

				const filtSnips = snippets.filter(snippet =>
					snippet.snippetFile.filePath.indexOf('Code.app') < (config.userOnly() ? 0 : 1000000000))
				return resolve(filtSnips);
			});
		});
	}
}
