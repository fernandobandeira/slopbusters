async function verifyRepositoryHistory(window, phase) {
  return window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (check) => {
      const deadline = Date.now() + 10000;
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error('Repository history did not settle.');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    const read = async () => {
      const response = await fetch('/api/preferences');
      if (!response.ok) throw new Error('Repository preferences could not be read.');
      return response.json();
    };
    const expected = ['smoke/last', 'smoke/previous'];
    if (${JSON.stringify(phase)} === 'write') {
      const select = async (repository) => {
        history.pushState({}, '', '/repos/' + repository + '/pulls?inbox=mine');
        dispatchEvent(new PopStateEvent('popstate'));
        await waitFor(() => document.querySelector('.repository-switcher-trigger')?.textContent.includes(repository));
        await waitFor(async () => (await read()).recentRepositories?.[0] === repository);
      };
      await select('smoke/previous');
      await select('smoke/last');
    }
    await waitFor(() => location.pathname === '/repos/smoke/last/pulls');
    const preferences = await read();
    if (JSON.stringify(preferences.recentRepositories?.slice(0, 2)) !== JSON.stringify(expected)) {
      throw new Error('Recent repository order did not persist across desktop launches.');
    }
    if (!document.querySelector('.repository-switcher-trigger')?.textContent.includes('smoke/last')) {
      throw new Error('The desktop app did not restore the most recent repository.');
    }
    return { repositoryHistory: true, repositoryOrigin: location.origin };
  })()`)
}

module.exports = { verifyRepositoryHistory }
