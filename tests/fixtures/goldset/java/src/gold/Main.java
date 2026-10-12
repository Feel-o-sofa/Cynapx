package gold;

import java.util.logging.Level;
import java.util.logging.Logger;

public class Main {
    public void useClient(Client c) {
        c.configure();
        Config.configure();
        Util.log(String.valueOf(Util.factorial(5)));
    }

    public void shutdown() {
        Logger.getGlobal().log(Level.INFO, "bye");
    }
}
