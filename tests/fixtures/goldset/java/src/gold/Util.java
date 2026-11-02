package gold;

public class Util {
    public static String format(int n) {
        return "#" + n;
    }

    public static void log(String msg) {
    }

    public static int factorial(int n) {
        return n <= 1 ? 1 : n * factorial(n - 1);
    }
}
