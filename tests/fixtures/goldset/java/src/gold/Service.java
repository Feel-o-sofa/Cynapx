package gold;

public class Service extends Base {
    @Override
    public void setup() {
        super.setup();
        shared();
    }

    public static void build() {
        Client c = new Client();
        c.configure();
        var svc = new Service();
        svc.setup();
    }
}
