function App() {
  const openDashboard = () => {
    browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
  };

  return (
    <>
      <h1>TabBuddy</h1>
      <button onClick={openDashboard}>Open dashboard</button>
    </>
  );
}

export default App;
