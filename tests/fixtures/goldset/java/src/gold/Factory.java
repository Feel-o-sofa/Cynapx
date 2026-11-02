package gold;

public class Factory {
    private Client client = new Client();

    public static Client make() {
        return new Client();
    }

    public void viaField() {
        client.configure();
    }

    public void viaThisField() {
        this.client.configure();
    }

    public void viaChain() {
        make().configure();
    }
}
