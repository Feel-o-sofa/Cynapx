package gold;

public class Base {
    public void setup() {
        Util.log("setup");
    }

    public int shared() {
        return 1;
    }
}
