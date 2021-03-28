import {
	ExtensionContext,
	commands,
	window
} 
from 'vscode';
import {registerCommands} from './commands';
import {SnippetLoader} from './snippets/snippetLoader';
import {SnippetTreeDataProvider} from './snippets/snippetTreeDataProvider';

export function activate(context: ExtensionContext) {
	const snippetLoader: SnippetLoader = new SnippetLoader();
	// create snippets tree view
	const snippetProvider = new SnippetTreeDataProvider(snippetLoader);
	window.createTreeView('snippets.view', {
		treeDataProvider: snippetProvider,
		showCollapseAll: false,
	});
	
	context.subscriptions.push(
		commands.registerCommand(`snippets.viewer.refreshSnippets`, () => snippetProvider.refresh(true))
	);

	// add other snippet commands
	registerCommands(context);
}

export function deactivate() {}
