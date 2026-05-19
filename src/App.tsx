import { AppView } from "./features/app/AppView";
import { useAppController } from "./hooks/useAppController";
import "./App.css";

function App() {
  return <AppView controller={useAppController()} />;
}

export default App;