import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Give every test a DOM. Tests of src/core do not use it.
GlobalRegistrator.register();
